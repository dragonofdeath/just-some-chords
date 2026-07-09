// Normalize an incoming request body to the songs collection's field set.
export function songFields(body: any) {
  const fields: Record<string, unknown> = {
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled",
    songKey: typeof body.songKey === "string" ? body.songKey : "G",
    bpm: typeof body.bpm === "number" ? body.bpm : 84,
    timeSignature: typeof body.timeSignature === "string" ? body.timeSignature : "4/4",
    sections: body.sections && typeof body.sections === "object" ? body.sections : { list: [] },
  };
  // Public-share token: only a sane opaque id passes through; omitting the
  // field on update clears it (update replaces the whole item).
  if (typeof body.shareId === "string" && /^[A-Za-z0-9-]{16,64}$/.test(body.shareId)) {
    fields.shareId = body.shareId;
  }
  return fields;
}
