// Minimal multipart/form-data parser for Next.js route handlers (Node runtime).
// No external dependencies. Handles file uploads and fields.
import "server-only";

export interface MultipartFile {
  name: string;
  filename: string;
  contentType: string;
  data: Buffer;
}
export interface MultipartFields {
  fields: Record<string, string>;
  files: MultipartFile[];
}

export async function parseMultipart(req: Request): Promise<MultipartFields> {
  const contentType = req.headers.get("content-type") || "";
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new Error("Missing multipart boundary");
  const boundary = "--" + (m[1] || m[2]).trim();
  const buf = Buffer.from(await req.arrayBuffer());

  const fields: Record<string, string> = {};
  const files: MultipartFile[] = [];

  // Split by boundary
  const parts: Buffer[] = [];
  let start = 0;
  while (true) {
    const idx = buf.indexOf(boundary, start);
    if (idx === -1) break;
    const next = buf.indexOf(boundary, idx + boundary.length);
    if (next === -1) {
      // last part ends with --
      parts.push(buf.subarray(idx + boundary.length, buf.length));
      break;
    }
    // Between boundaries there are \r\n after boundary and \r\n before next boundary
    parts.push(buf.subarray(idx + boundary.length + 2, next - 2));
    start = next;
  }

  for (const p of parts) {
    // find header/body separator \r\n\r\n
    const sep = Buffer.from("\r\n\r\n");
    const sepIdx = p.indexOf(sep);
    if (sepIdx === -1) continue;
    const headerRaw = p.subarray(0, sepIdx).toString("utf8");
    let body = p.subarray(sepIdx + sep.length);
    // Trim trailing \r\n
    if (body.length >= 2 && body[body.length-2] === 0x0d && body[body.length-1] === 0x0a) {
      body = body.subarray(0, body.length - 2);
    }
    const cdMatch = /content-disposition:\s*form-data;\s*(.*)/i.exec(headerRaw);
    if (!cdMatch) continue;
    const params = cdMatch[1];
    const nameMatch = /name="([^"]*)"/i.exec(params);
    const fileMatch = /filename="([^"]*)"/i.exec(params);
    const ctMatch = /content-type:\s*([^\r\n;]+)/i.exec(headerRaw);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    if (fileMatch) {
      files.push({
        name,
        filename: fileMatch[1],
        contentType: ctMatch ? ctMatch[1].trim() : "application/octet-stream",
        data: Buffer.from(body),
      });
    } else {
      fields[name] = body.toString("utf8");
    }
  }
  return { fields, files };
}
