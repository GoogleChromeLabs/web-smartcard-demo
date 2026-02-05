import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as path from "path";
import * as wbnSign from "wbn-sign";
import * as fs from "fs";
import * as puppeteer from "puppeteer-core";

const CONNECTION_URL = 'http://localhost:9222';
const VIRTUAL_READER_NAME = "My Virtual Reader";
const BUNDLE_PATH = path.join(process.cwd(), "dist", "smart_card_demo.swbn");


const VALID_ATR_BASE64 = Buffer.from('3B00', 'hex').toString('base64');

describe('Smart Card IWA Emulation', () => {
    let browser, browserSession, appPage, appClient, manifestId;

    before(async () => {
        assert.ok(fs.existsSync(BUNDLE_PATH), `Bundle not found at: ${BUNDLE_PATH}`);
        const bundleContent = new Uint8Array(await fs.promises.readFile(BUNDLE_PATH));
        const appId = wbnSign.getBundleId(bundleContent);
        manifestId = `isolated-app://${appId}`;

        console.log(`\n📞 Connecting to Chrome at ${CONNECTION_URL}...`);
        browser = await puppeteer.connect({ browserURL: CONNECTION_URL, defaultViewport: null });
        browserSession = await browser.target().createCDPSession();

        try {
            await browserSession.send("PWA.getOsAppState", { manifestId });
        } catch (e) {
            console.log("⬇️ App not installed. Installing...");
            await browserSession.send("PWA.install", { manifestId, installUrlOrBundleUrl: `file://${BUNDLE_PATH}` });
        }

        await browserSession.send("PWA.launch", { manifestId });

        const appTarget = await browser.waitForTarget(t => t.url().startsWith(manifestId) && t.type() === 'page');
        appPage = await appTarget.page();
        appClient = await appTarget.createCDPSession();
        
        await setupEmulation(appClient);
    });

    after(async () => {
        if (browser) await browser.disconnect();
    });

    it('should connect to reader and disconnect gracefully', async () => {
        const refreshBtn = await appPage.waitForSelector('#refresh-readers');
        await refreshBtn.click();

        const readerSpan = await appPage.waitForSelector(`xpath///span[contains(text(), '${VIRTUAL_READER_NAME}')]`);
        const readerContainer = await readerSpan.evaluateHandle(el => el.parentElement);
        
        console.log("🖱️ Clicking 'Connect'...");
        const connectBtn = await appPage.waitForSelector('#btn-connect');
        await connectBtn.click();

        await appPage.waitForFunction(
            () => document.body.innerText.includes('Connected with protocol: t1'),
            { timeout: 15000 }
        );
        console.log("✅ Connected successfully.");

        console.log("🖱️ Clicking 'Disconnect'...");
        const disconnectBtn = await appPage.waitForSelector('#btn-disconnect');
        await disconnectBtn.click();

        await appPage.waitForFunction(
            () => document.body.innerText.includes('Disconnected.'),
            { timeout: 5000 }
        );
        console.log("✅ Disconnected successfully.");
    });
});

async function setupEmulation(client) {
    client.on('SmartCardEmulation.establishContextRequested', async (e) => {
        await client.send('SmartCardEmulation.reportEstablishContextResult', { requestId: e.requestId, contextId: 101 });
    });

    client.on('SmartCardEmulation.listReadersRequested', async (e) => {
        await client.send('SmartCardEmulation.reportListReadersResult', { requestId: e.requestId, readers: [VIRTUAL_READER_NAME] });
    });

    client.on('SmartCardEmulation.getStatusChangeRequested', async (e) => {
        const newStates = e.readerStates.map(rs => ({
            reader: rs.reader, 
            eventState: { present: true, changed: false }, 
            eventCount: rs.currentInsertionCount, 
            atr: VALID_ATR_BASE64 
        }));
        await client.send('SmartCardEmulation.reportGetStatusChangeResult', { requestId: e.requestId, readerStates: newStates });
    });

    client.on('SmartCardEmulation.connectRequested', async (e) => {
        await client.send('SmartCardEmulation.reportConnectResult', { requestId: e.requestId, handle: 99, activeProtocol: 't1' });
    });

    client.on('SmartCardEmulation.beginTransactionRequested', async (e) => {
        console.log("🔄 Transaction Lock Requested");
        await client.send('SmartCardEmulation.reportBeginTransactionResult', { 
            requestId: e.requestId,
            handle: e.handle
        });
    });

    client.on('SmartCardEmulation.endTransactionRequested', async (e) => {
        console.log(`🔄 End Transaction Requested (Disposition: ${e.disposition})`);
        await client.send('SmartCardEmulation.reportPlainResult', {
            requestId: e.requestId
        });
    });

    client.on('SmartCardEmulation.disconnectRequested', async (e) => {
        console.log("🔌 Disconnect Requested");
        await client.send('SmartCardEmulation.reportPlainResult', {
            requestId: e.requestId
        });
    });

    await client.send('SmartCardEmulation.enable');
}