import assert from "node:assert/strict";
import jsQR from "jsqr";
import { recoverTypedDataAddress } from "viem";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function previewWalletBrowser(t){
  const source=process.env.PREVIEW_RELEASE_KIT;
  if(!source) throw Error("Set PREVIEW_RELEASE_KIT to the installed release-kit directory");
  const require=createRequire(resolve(source,"package.json"));
  const {default:puppeteer}=await import(pathToFileURL(require.resolve("puppeteer-core")));
  const browser=await puppeteer.launch({executablePath:process.env.RELEASE_CHROME || "/usr/bin/google-chrome",headless:true,
    args:["--no-sandbox","--disable-dev-shm-usage","--disable-background-networking"]});
  t.after(()=>browser.close());
  return browser;
}
export async function payWithPreviewWallet(browser,qa,payer,merchant,toGateway) {
  const page = await browser.newPage();
  let signs = 0;
  await page.exposeFunction("fixtureRpc", async ({ method, params }) => {
    if (["eth_requestAccounts","eth_accounts"].includes(method)) return [payer.address];
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_signTypedData_v4") {
      signs++; const typed = JSON.parse(params[1]); assert.equal(typed.message.value, "10000"); assert.equal(typed.message.to.toLowerCase(), merchant.toLowerCase());
      const signature = await payer.signTypedData(typed);
      assert.equal(await recoverTypedDataAddress({ ...typed, signature }), payer.address); return signature;
    }
    throw Error("unexpected fixture wallet method " + method);
  });
  await page.evaluateOnNewDocument(() => { window.ethereum = { request: arg => window.fixtureRpc(arg) }; });
  await page.setRequestInterception(true);
  page.on("request", async request => {
    if (new URL(request.url()).origin !== "https://agents.samedaydesk.com") return request.abort();
    const response = await toGateway(new Request(request.url(), { headers: request.headers() }));
    await request.respond({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  });
  await page.goto(qa.wallet);
  await page.waitForSelector("#pay:not([hidden])", { timeout: 10000 });
  await page.waitForSelector("#mobile:not([hidden])");
  const code=await page.$eval("#code",canvas=>{
    const {data,width,height}=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height);
    return {pixels:Array.from(data),width,height};
  });
  assert.equal(jsQR(Uint8ClampedArray.from(code.pixels),code.width,code.height)?.data,qa.wallet);
  assert.equal(signs,0);
  await page.click("#pay");
  await page.waitForFunction(() => document.querySelector("#state").textContent.startsWith("Paid."), { timeout: 10000 });
  assert.equal(signs, 1); await page.close();
}
