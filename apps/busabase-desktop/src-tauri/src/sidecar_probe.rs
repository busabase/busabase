use std::{
    io::{BufRead, BufReader, Write},
    net::{SocketAddr, TcpStream},
    time::{Duration, Instant},
};

struct HttpResponse {
    status: u16,
    location: Option<String>,
}

pub(crate) fn http_status(
    address: SocketAddr,
    path: &str,
    timeout: Duration,
) -> Result<u16, String> {
    http_response(address, path, timeout).map(|response| response.status)
}

fn http_response(
    address: SocketAddr,
    path: &str,
    timeout: Duration,
) -> Result<HttpResponse, String> {
    let deadline = Instant::now() + timeout;
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|error| format!("{path}: {error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .and_then(|_| stream.set_write_timeout(Some(timeout)))
        .map_err(|error| format!("{path}: {error}"))?;
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: localhost:{}\r\nConnection: close\r\n\r\n",
        address.port()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| format!("{path}: {error}"))?;

    // Read only bounded headers: a streamed dashboard need not finish sending
    // its HTML before it is ready to load in the WebView.
    let mut reader = BufReader::new(stream);
    let status_line = read_header_line(&mut reader, path, 1024, deadline)?;
    let mut parts = status_line.split_whitespace();
    let protocol = parts.next();
    let status = parts.next().and_then(|value| value.parse::<u16>().ok());
    let status = match (protocol, status) {
        (Some("HTTP/1.0" | "HTTP/1.1"), Some(status @ 100..=599)) => status,
        _ => return Err(format!("{path}: invalid HTTP status line")),
    };
    let mut location = None;
    let mut remaining = 16 * 1024;
    while remaining > 0 {
        let line = read_header_line(&mut reader, path, remaining, deadline)?;
        remaining -= line.len();
        if line.trim().is_empty() {
            return Ok(HttpResponse { status, location });
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("location") {
                location = Some(value.trim().to_string());
            }
        }
    }
    Err(format!("{path}: HTTP headers exceeded 16384 bytes"))
}

fn read_header_line(
    reader: &mut BufReader<TcpStream>,
    path: &str,
    limit: usize,
    deadline: Instant,
) -> Result<String, String> {
    let mut line = Vec::new();
    for _ in 0..limit {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(format!("{path}: HTTP readiness probe timed out"));
        }
        reader
            .get_ref()
            .set_read_timeout(Some(remaining))
            .map_err(|error| format!("{path}: {error}"))?;
        let buffer = reader
            .fill_buf()
            .map_err(|error| format!("{path}: {error}"))?;
        let Some(byte) = buffer.first().copied() else {
            return Err(format!("{path}: incomplete HTTP headers"));
        };
        reader.consume(1);
        line.push(byte);
        if byte == b'\n' {
            return String::from_utf8(line).map_err(|_| format!("{path}: invalid HTTP headers"));
        }
    }
    Err(format!("{path}: HTTP header line exceeded {limit} bytes"))
}

pub(crate) fn check_dashboard(address: SocketAddr, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let mut path = "/dashboard".to_string();
    for _ in 0..=5 {
        let response = http_response(
            address,
            &path,
            deadline.saturating_duration_since(Instant::now()),
        )?;
        if response.status == 200 {
            return Ok(());
        }
        if !matches!(response.status, 301 | 302 | 303 | 307 | 308) {
            return Err(format!("{path} returned HTTP {}", response.status));
        }
        let location = response
            .location
            .ok_or_else(|| format!("{path}: redirect has no Location"))?;
        path = local_redirect_path(address, &path, &location)
            .ok_or_else(|| format!("{path}: refused non-local dashboard redirect"))?;
    }
    Err("/dashboard: exceeded 5 redirects".to_string())
}

fn local_redirect_path(address: SocketAddr, current_path: &str, location: &str) -> Option<String> {
    if location.contains(['\r', '\n', '\\']) {
        return None;
    }
    let base = tauri::Url::parse(&format!(
        "http://localhost:{}{current_path}",
        address.port()
    ))
    .ok()?;
    let target = base.join(location).ok()?;
    if target.scheme() != "http"
        || !matches!(target.host_str(), Some("localhost" | "127.0.0.1"))
        || target.port_or_known_default() != Some(address.port())
        || !target.username().is_empty()
        || target.password().is_some()
    {
        return None;
    }
    let mut path = target.path().to_string();
    if let Some(query) = target.query() {
        path.push('?');
        path.push_str(query);
    }
    Some(path)
}

#[cfg(test)]
mod tests {
    use super::{check_dashboard, http_status, local_redirect_path};
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };

    fn probe_response(response: &[u8]) -> Result<u16, String> {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let response = response.to_vec();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 1024];
            let read = stream.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..read]).starts_with("GET /dashboard "));
            stream.write_all(&response).unwrap();
        });
        let status = http_status(address, "/dashboard", Duration::from_secs(1));
        server.join().unwrap();
        status
    }

    #[test]
    fn restricts_redirects_to_the_same_loopback_origin() {
        let address = "127.0.0.1:15419".parse().unwrap();
        assert_eq!(
            local_redirect_path(address, "/dashboard", "/dashboard/local/home"),
            Some("/dashboard/local/home".to_string())
        );
        assert_eq!(
            local_redirect_path(
                address,
                "/dashboard",
                "http://localhost:15419/dashboard/local/home"
            ),
            Some("/dashboard/local/home".to_string())
        );
        for location in [
            "http://localhost:154190/other",
            "https://example.com",
            "//example.com",
            "/\\example.com",
            "/dashboard\r\ninjected",
            "http://user@localhost:15419/dashboard",
            "http://localhost:15500/dashboard",
        ] {
            assert!(local_redirect_path(address, "/dashboard", location).is_none());
        }
        assert_eq!(
            local_redirect_path(address, "/dashboard/local/", "home?lang=zh-CN#section"),
            Some("/dashboard/local/home?lang=zh-CN".to_string())
        );
    }

    #[test]
    fn follows_dashboard_redirects_to_the_actual_rendered_page() {
        for final_status in [200, 500] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = thread::spawn(move || {
                for (path, response) in [
                    ("/dashboard", "HTTP/1.1 308 Permanent Redirect\r\nLocation: /dashboard/local/home\r\n\r\n".to_string()),
                    ("/dashboard/local/home", format!("HTTP/1.1 {final_status} Response\r\n\r\n")),
                ] {
                    let (mut stream, _) = listener.accept().unwrap();
                    let mut request = [0; 1024];
                    let read = stream.read(&mut request).unwrap();
                    assert!(String::from_utf8_lossy(&request[..read]).starts_with(&format!("GET {path} ")));
                    stream.write_all(response.as_bytes()).unwrap();
                }
            });
            let result = check_dashboard(address, Duration::from_secs(1));
            server.join().unwrap();
            if final_status == 200 {
                assert!(result.is_ok());
            } else {
                assert!(result
                    .unwrap_err()
                    .contains("/dashboard/local/home returned HTTP 500"));
            }
        }
    }

    #[test]
    fn ignores_streamed_or_non_utf8_html_after_headers() {
        assert_eq!(probe_response(b"HTTP/1.0 200 OK\r\n\r\n\xff").unwrap(), 200);
    }

    #[test]
    fn rejects_malformed_or_truncated_responses() {
        assert!(probe_response(b"not HTTP\r\n").is_err());
        assert!(probe_response(b"HTTP/1.1 999 Invalid\r\n").is_err());
        assert!(probe_response(b"HTTP/1.1 200 OK").is_err());
        assert!(probe_response(&vec![b'a'; 1025]).is_err());
    }

    #[test]
    fn times_out_when_the_dashboard_does_not_respond() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (_stream, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_millis(100));
        });
        let result = check_dashboard(address, Duration::from_millis(20));
        server.join().unwrap();
        assert!(result.unwrap_err().contains("/dashboard:"));
    }

    #[test]
    fn rejects_redirect_loops_and_external_redirects() {
        for location in ["/dashboard", "https://example.com/dashboard"] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let expected_requests = if location == "/dashboard" { 6 } else { 1 };
            let server = thread::spawn(move || {
                for _ in 0..expected_requests {
                    let (mut stream, _) = listener.accept().unwrap();
                    let mut request = [0; 1024];
                    stream.read(&mut request).unwrap();
                    stream
                        .write_all(
                            format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\n\r\n")
                                .as_bytes(),
                        )
                        .unwrap();
                }
            });
            let result = check_dashboard(address, Duration::from_secs(1));
            server.join().unwrap();
            assert!(result.is_err());
        }
    }
}
