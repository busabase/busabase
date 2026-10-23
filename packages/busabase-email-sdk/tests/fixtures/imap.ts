import { createServer, type Socket } from "node:net";

/** A real local IMAP protocol fixture. No external mailbox, credentials, or network required. */
export const mailboxFixture = async () => {
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  const messages = new Map([
    [
      2,
      "From: unrelated@example.net\r\nTo: sales@example.com\r\nSubject: Other\r\nMessage-ID: <other@example.net>\r\n\r\nUnrelated",
    ],
    [
      5,
      "From: buyer@example.net\r\nTo: sales@example.com\r\nSubject: Re: Hello\r\nMessage-ID: <five@example.net>\r\nIn-Reply-To: <sent@example.com>\r\n\r\nYes please.",
    ],
    [
      9,
      "From: buyer@example.net\r\nTo: sales@example.com\r\nSubject: Re: Hello\r\nMessage-ID: <nine@example.net>\r\n\r\nAnother reply.",
    ],
  ]);
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("* OK IMAP fixture ready\r\n");
    let pending = "";
    socket.on("data", (data) => {
      pending += data.toString();
      while (pending.includes("\r\n")) {
        const end = pending.indexOf("\r\n");
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        commands.push(line);
        const tag = line.split(" ")[0] ?? "";
        const command = line.slice(tag.length + 1);
        if (/^CAPABILITY/i.test(command)) socket.write("* CAPABILITY IMAP4rev1\r\n");
        else if (/^(?:LIST|LSUB)/i.test(command)) socket.write('* LIST () "/" "INBOX"\r\n');
        else if (/^(?:EXAMINE|SELECT)/i.test(command)) {
          socket.write(
            "* FLAGS (\\Seen)\r\n* 3 EXISTS\r\n* OK [UIDVALIDITY 77] valid\r\n* OK [UIDNEXT 10] next\r\n",
          );
        } else if (/^UID SEARCH/i.test(command)) {
          const start = Number(command.match(/UID (\d+):\*/i)?.[1] ?? 1);
          socket.write(
            `* SEARCH ${[...messages.keys()].filter((uid) => uid >= start).join(" ")}\r\n`,
          );
        } else if (/^UID FETCH/i.test(command)) {
          const uid = Number(command.match(/^UID FETCH (\d+)/i)?.[1]);
          const raw = messages.get(uid);
          if (raw)
            socket.write(
              `* ${[...messages.keys()].indexOf(uid) + 1} FETCH (UID ${uid} BODY[] {${Buffer.byteLength(raw)}}\r\n${raw})\r\n`,
            );
        } else if (/^LOGOUT/i.test(command)) {
          socket.write(`* BYE closing\r\n${tag} OK logout\r\n`);
          socket.end();
          continue;
        }
        socket.write(`${tag} OK ${/^EXAMINE/i.test(command) ? "[READ-ONLY] " : ""}completed\r\n`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture has no port");
  return {
    commands,
    sockets,
    config: {
      host: "127.0.0.1",
      port: address.port,
      secure: false,
      doSTARTTLS: false as const,
      auth: { user: "fixture", pass: "fixture" },
      logger: false as const,
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
};
