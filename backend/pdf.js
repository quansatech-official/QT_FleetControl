import puppeteer from "puppeteer-core";

export async function renderPdfFromHtml(html) {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox"]
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  await browser.close();
  return pdf;
}