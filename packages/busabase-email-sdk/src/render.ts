import { convert } from "html-to-text";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { EmailMessage, RenderedEmail } from "./types.js";

const assertHeader = (name: string, value: string): void => {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`${name} must not contain CR, LF, or NUL characters`);
  }
};

/** Validate before handing any user-controlled headers to a transport. */
export const validateEmailHeaders = (message: EmailMessage): void => {
  for (const field of [
    "from",
    "to",
    "cc",
    "bcc",
    "subject",
    "replyTo",
    "inReplyTo",
    "references",
  ] as const) {
    const value = message[field];
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      assertHeader(field, item);
    }
  }
  for (const [name, value] of Object.entries(message.headers ?? {})) {
    if (!/^[!#$%&'*+\-.^_`|~\da-z]+$/i.test(name)) {
      throw new Error("Invalid custom email header name");
    }
    // These are owned by structured message fields and the MIME composer.
    if (
      /^(from|to|cc|bcc|subject|reply-to|in-reply-to|references|message-id|mime-version|content-type|content-transfer-encoding)$/i.test(
        name,
      )
    ) {
      throw new Error(`Use structured email fields instead of the ${name} header`);
    }
    assertHeader(name, value);
  }
  for (const attachment of message.attachments ?? []) {
    assertHeader("attachment filename", attachment.filename);
    if (attachment.contentType) assertHeader("attachment contentType", attachment.contentType);
    if (attachment.cid) assertHeader("attachment cid", attachment.cid);
  }
  for (const [name, value] of Object.entries(message.tags ?? {})) {
    assertHeader("tag name", name);
    assertHeader("tag value", value);
  }
};

const isEmailImageSource = (src: string | undefined): boolean => {
  if (!src) return false;
  if (/^cid:[^\s]+$/i.test(src)) return true;
  if (!/^https?:\/\//i.test(src)) return false;
  try {
    return Boolean(new URL(src).hostname);
  } catch {
    return false;
  }
};

const sanitizeEmailHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["style"],
      a: ["href", "title", "name", "target", "rel", "style"],
      img: ["src", "alt", "title", "width", "height", "style"],
      td: ["colspan", "rowspan", "align", "valign", "style"],
      th: ["colspan", "rowspan", "align", "valign", "style"],
      table: ["width", "cellpadding", "cellspacing", "border", "role", "style"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "cid"] },
    allowProtocolRelative: false,
    // Relative paths have no useful base URL in an email client.
    exclusiveFilter: (frame) => frame.tag === "img" && !isEmailImageSource(frame.attribs.src),
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, style: `${attribs.style ?? ""};text-decoration:underline` },
      }),
    },
    allowedStyles: {
      "*": {
        color: [/^#[\da-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        "background-color": [/^#[\da-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
        "font-family": [/^[\w\s,'"-]+$/],
        "font-size": [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/],
        "text-align": [/^(?:left|right|center|justify)$/],
        "text-decoration": [/^(?:none|underline|line-through)$/],
        "line-height": [/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)?$/],
        "max-width": [/^\d+(?:\.\d+)?(?:px|%)$/],
        width: [/^\d+(?:\.\d+)?(?:px|%)$/],
        height: [/^(?:auto|\d+(?:\.\d+)?(?:px|%))$/],
        display: [/^(?:block|inline|inline-block|table|table-cell)$/],
        padding: [/^[\d\s.pxemr%]+$/],
        margin: [/^(?:auto|[\d\s.pxemr%]+)$/],
        border: [/^\d+px\s+(?:solid|dashed|dotted)\s+#[\da-f]{3,8}$/i],
        "border-radius": [/^\d+(?:\.\d+)?(?:px|%)$/],
        "border-collapse": [/^(?:collapse|separate)$/],
      },
    },
  });

/** Generate safe HTML and a readable fallback with full link destinations. */
export const renderEmail = async (message: EmailMessage): Promise<RenderedEmail> => {
  validateEmailHeaders(message);
  if (![message.text, message.html, message.markdown].some((value) => value?.trim())) {
    throw new Error("Email must contain text, HTML, or Markdown content");
  }
  const { markdown, ...rest } = message;
  const sourceHtml =
    message.html ?? (markdown === undefined ? undefined : await marked.parse(markdown));
  const html = sourceHtml === undefined ? undefined : sanitizeEmailHtml(sourceHtml);
  const text =
    message.text ??
    convert(html ?? "", {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { hideLinkHrefIfSameAsText: true } },
        { selector: "h1", options: { uppercase: false } },
        { selector: "h2", options: { uppercase: false } },
        { selector: "h3", options: { uppercase: false } },
        { selector: "img", format: "skip" },
      ],
    });
  if (!text.trim() && !html?.trim()) throw new Error("Email has no content after sanitization");
  return { ...rest, text, ...(html === undefined ? {} : { html }) };
};
