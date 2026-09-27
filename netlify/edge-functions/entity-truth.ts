export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) return response;

  let html = await response.text();

  // TEMPORARY ENTITY-TRUTH SAFETY NET
  // Source pages are being cleaned progressively. Until every legacy page is
  // corrected, this edge transform prevents crawlers and visitors from being
  // served stale Village Den / opening-hours facts.

  // Remove standalone HTML cards/articles for the retired Village Den product.
  html = html.replace(
    /<article\b[^>]*>(?:(?!<\/article>)[\s\S])*?Village Den(?:(?!<\/article>)[\s\S])*?<\/article>/gi,
    ""
  );

  // Correct structured-data and visible copy that says there are three rooms.
  html = html
    .replace(/Three professional meeting spaces/gi, "Two professional meeting spaces")
    .replace(/Three professional meeting rooms/gi, "Two professional meeting rooms")
    .replace(/Three Meeting Rooms/gi, "Two Meeting Rooms")
    .replace(/three meeting spaces/gi, "two meeting spaces")
    .replace(/three meeting rooms/gi, "two meeting rooms")
    .replace(/Three rooms:/gi, "Two rooms:")
    .replace(/three rooms:/gi, "two rooms:")
    .replace(/"offerCount"\s*:\s*3/gi, '"offerCount":2')
    .replace(/"lowPrice"\s*:\s*"180"/gi, '"lowPrice":"350"');

  // Remove common Village Den list / sentence fragments.
  html = html
    .replace(/,?\s*(and\s+)?the Village Den(?: \(4-seater\))?(?: is ideal for smaller meetings of up to 4 people)?/gi, "")
    .replace(/Smaller meeting\?\s*See the Village Den \(4-seater\)\.?/gi, "")
    .replace(/For smaller meetings of up to 4 people, see our Village Den\.?/gi, "")
    .replace(/Village Den \(4-seater\),?\s*/gi, "")
    .replace(/Village Den[^<]{0,140}R180(?:\/hour| per hour)?/gi, "");

  // Correct old minimum meeting-room pricing in general legacy copy.
  html = html
    .replace(/meeting rooms from R180\/hour/gi, "meeting rooms from R350/hour")
    .replace(/meeting room(?:s)?[^<]{0,50}from R180\/hour/gi, (m) => m.replace(/R180\/hour/i, "R350/hour"))
    .replace(/From <strong>R180\/hour<\/strong>/gi, "From <strong>R350/hour</strong>")
    .replace(/From R180\/hour/gi, "From R350/hour")
    .replace(/from R180\/hour/gi, "from R350/hour")
    .replace(/from R180\/hr/gi, "from R350/hr");

  // Canonical public hours: Monday-Friday 07:00-18:00.
  html = html
    .replace(/06:30\s*[–-]\s*18:00/gi, "07:00 – 18:00")
    .replace(/06h30\s*[–-]\s*18h00/gi, "07h00 – 18h00")
    .replace(/"opens"\s*:\s*"06:30"/gi, '"opens":"07:00"');

  // If a stale sentence still enumerates Den between the two valid rooms,
  // collapse it to the two actual bookable meeting products.
  html = html.replace(
    /The Village Den[^.]*?Village Chamber[^.]*?Village Boardroom[^.]*?\./gi,
    "The Village Chamber (10-seater) is R350/hour and the Village Boardroom (12-seater) is R390/hour."
  );

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("x-villagehub-entity-truth", "2026-09-27");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const config = {
  path: "/*",
};
