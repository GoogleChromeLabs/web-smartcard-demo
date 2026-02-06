import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as puppeteer from "puppeteer-core";
import { constructBerTlv, generateSelfSignedCertHex } from './test-utils.js';

const CONFIG = {
  CONNECTION_URL: 'http://localhost:9222',
  VIRTUAL_READER_NAME: "Virtual Cert Reader",
  VALID_ATR: Buffer.from('3B0102', 'hex').toString('base64'),
  APP_ID: 'isolated-app://w2gqjem6b4m7vhiqpjr3btcpp7dxfyjt6h4uuyuxklcsmygtgncaaaac',
  DEV_SERVER_PORT: 8080,
  DEV_SERVER_URL: 'http://localhost:8080',
  CERT_COMMON_NAME: "Dynamic Test Card",
  DIST_DIR: path.join(process.cwd(), 'dist')
};

const APDU = {
  Instruction: { Select: 0xA4, GetData: 0xCB },
  Tag: { Certificate: 0x70, DiscretionaryData: 0x53 },
  SW_SUCCESS: Buffer.from([0x90, 0x00]),
  SW_UNKNOWN: Buffer.from([0x6A, 0x81])
};

let mockCertHex = "";
let devServer;

async function startDevServer(port, directory) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const safePath = path.normalize(req.url).replace(/^(\.\.[\/\\])+/, '');
      let filePath = path.join(directory, safePath === '/' ? 'index.html' : safePath);

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
        if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
        if (filePath.endsWith('.json') || filePath.endsWith('.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json');

        res.writeHead(200);
        res.end(data);
      });
    });

    const sockets = new Set();
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    // Attach a helper method to force-close all connections
    server.forceClose = async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      return new Promise((cb) => server.close(cb));
    };

    server.listen(port, () => {
      console.log(`🌍 Dev Server started at http://localhost:${port} serving ${directory}`);
      resolve(server);
    });
  });
}

describe('Smart Card Read Certificate Test', () => {
  let browser, browserSession, appPage, appClient, manifestId;

  before(async () => {
    devServer = await startDevServer(CONFIG.DEV_SERVER_PORT, CONFIG.DIST_DIR);

    manifestId = CONFIG.APP_ID;
    console.log("⚙️ Generating valid X.509 certificate...");
    mockCertHex = await generateSelfSignedCertHex(CONFIG.CERT_COMMON_NAME);

    console.log(`\n📞 Connecting to Chrome at ${CONFIG.CONNECTION_URL}...`);
    browser = await puppeteer.connect({ browserURL: CONFIG.CONNECTION_URL, defaultViewport: null });
    browserSession = await browser.target().createCDPSession();

    try {
      const tempPage = await browser.newPage();
      const response = await tempPage.goto(CONFIG.DEV_SERVER_URL, { timeout: 2000 });
      if (!response.ok()) throw new Error(`Server returned ${response.status()}`);
      await tempPage.close();
    } catch (e) {
      console.warn(`⚠️ Warning: Browser cannot reach ${CONFIG.DEV_SERVER_URL}. If testing remotely, ensure SSH tunnel is active.`);
    }

    try {
      await browserSession.send("PWA.getOsAppState", { manifestId });
      console.log("✅ App is already installed.");
    } catch (e) {
      console.log("⬇️ App not installed. Installing...");
      await browserSession.send("PWA.install", {
        manifestId,
        installUrlOrBundleUrl: CONFIG.DEV_SERVER_URL
      });
      console.log("✅ App was successfully installed.");
    }

    await browserSession.send("PWA.launch", { manifestId });

    const appTarget = await browser.waitForTarget(t => t.url().startsWith(manifestId) && t.type() === 'page');
    appPage = await appTarget.page();
    appClient = await appTarget.createCDPSession();

    await setupEmulation(appClient);
  });

  after(async () => {
    if (browser) await browser.disconnect();
    if (devServer) {
      await devServer.forceClose();
      console.log("🛑 Dev Server stopped.");
    }
  });

  afterEach(async () => {
    if (!appPage) return;
    const isConnected = await appPage.evaluate(() => {
      const disconnectBtn = document.getElementById('btn-disconnect');
      return disconnectBtn && !disconnectBtn.disabled;
    });

    if (isConnected) {
      await click('#btn-disconnect');
      await appPage.waitForFunction(() => document.body.innerText.includes('Disconnected.'));
    }
  });

  const click = async (selector) => {
    console.log(`🖱️ Clicking '${selector}'...`);
    const btn = await appPage.waitForSelector(selector);
    await btn.click();
  };

  /**
   * Checks the UI for any visible error messages.
   * Throws an error if a fatal application error is found.
   */
  const checkForAppErrors = async () => {
    const errorText = await appPage.evaluate(() => {
      // Find all divs that contain "Error:"
      const errEl = Array.from(document.querySelectorAll('div'))
        .find(d => d.textContent.includes('Error:'));

      // Filter out benign warnings (like the ATR warning), 
      // focus only on fatal parsing or reading errors.
      if (errEl && (
        errEl.textContent.includes('Failed to read') ||
        errEl.textContent.includes('Constructed encoding') ||
        errEl.textContent.includes('End of input')
      )) {
        return errEl.textContent;
      }
      return null;
    });

    if (errorText) {
      throw new Error(`Application Error Detected: ${errorText}`);
    }
  };

  it('should connect and disconnect successfully', async () => {
    await click('#refresh-readers');
    await appPage.waitForSelector(`xpath///span[contains(text(), '${CONFIG.VIRTUAL_READER_NAME}')]`);

    await click('#btn-connect');
    await appPage.waitForFunction(() => document.body.innerText.includes('Connected with protocol: t1'));

    const connectBtnDisabled = await appPage.$eval('#btn-connect', el => el.disabled);
    const disconnectBtnEnabled = await appPage.$eval('#btn-disconnect', el => !el.disabled);
    assert.strictEqual(connectBtnDisabled, true, "Connect button should be disabled");
    assert.strictEqual(disconnectBtnEnabled, true, "Disconnect button should be enabled");

    await click('#btn-disconnect');
    await appPage.waitForFunction(() => document.body.innerText.includes('Disconnected.'));
    console.log('✅ Basic Connectivity Passed');
  });

  it('should connect, read certificate, display it correctly and disconnect', async () => {
    await click('#refresh-readers');
    await appPage.waitForSelector(`xpath///span[contains(text(), '${CONFIG.VIRTUAL_READER_NAME}')]`);

    await click('#btn-connect');
    await appPage.waitForFunction(() => document.body.innerText.includes('Connected with protocol: t1'));

    await click('#btn-read-certificate');

    try {
      await appPage.waitForFunction(
        () => document.querySelector('#readers-list table') || document.body.innerText.includes('Error:'),
        { timeout: 8000 }
      );
    } catch (e) {
      throw new Error("UI timed out waiting for certificate table or error message.");
    }

    await checkForAppErrors();

    const tableContent = await appPage.evaluate(() => document.body.innerText);
    assert.ok(tableContent.includes("X.509 Certificate"), "Header title missing");
    assert.ok(tableContent.includes(CONFIG.CERT_COMMON_NAME), "Certificate Subject missing");

    console.log("🎉 Success: Certificate displayed!");

    await click('#btn-disconnect');
    await appPage.waitForFunction(() => document.body.innerText.includes('Disconnected.'));
  });
});

async function setupEmulation(client) {
  await client.send('SmartCardEmulation.enable');

  client.on('SmartCardEmulation.establishContextRequested', async (e) => {
    await client.send('SmartCardEmulation.reportEstablishContextResult', { requestId: e.requestId, contextId: 101 });
  });

  client.on('SmartCardEmulation.listReadersRequested', async (e) => {
    await client.send('SmartCardEmulation.reportListReadersResult', { requestId: e.requestId, readers: [CONFIG.VIRTUAL_READER_NAME] });
  });

  client.on('SmartCardEmulation.getStatusChangeRequested', async (e) => {
    const newStates = e.readerStates.map(rs => ({
      reader: rs.reader,
      eventState: { present: true, changed: false },
      eventCount: rs.currentInsertionCount,
      atr: CONFIG.VALID_ATR
    }));
    await client.send('SmartCardEmulation.reportGetStatusChangeResult', { requestId: e.requestId, readerStates: newStates });
  });

  client.on('SmartCardEmulation.connectRequested', async (e) => {
    await client.send('SmartCardEmulation.reportConnectResult', { requestId: e.requestId, handle: 99, activeProtocol: 't1' });
  });

  client.on('SmartCardEmulation.beginTransactionRequested', async (e) => {
    console.log("🔄 Transaction Lock Requested");
    await client.send('SmartCardEmulation.reportBeginTransactionResult', { requestId: e.requestId, handle: e.handle });
  });

  client.on('SmartCardEmulation.endTransactionRequested', async (e) => {
    console.log("🔄 End Transaction Requested");
    await client.send('SmartCardEmulation.reportPlainResult', { requestId: e.requestId });
  });

  client.on('SmartCardEmulation.transmitRequested', async (e) => {
    const bytes = Buffer.from(e.data, 'base64');
    const ins = bytes[1];
    let responseBuffer = APDU.SW_UNKNOWN;

    if (ins === APDU.Instruction.Select) {
      responseBuffer = APDU.SW_SUCCESS;
    }
    else if (ins === APDU.Instruction.GetData) {
      console.log("   -> Replying GET DATA: CERT");
      const rawCertBytes = Buffer.from(mockCertHex, 'hex');
      const certTlv = constructBerTlv(APDU.Tag.Certificate, rawCertBytes);
      const dataTlv = constructBerTlv(APDU.Tag.DiscretionaryData, certTlv);
      responseBuffer = Buffer.concat([dataTlv, APDU.SW_SUCCESS]);
    }

    await client.send('SmartCardEmulation.reportDataResult', {
      requestId: e.requestId,
      data: responseBuffer.toString('base64')
    });
  });

  client.on('SmartCardEmulation.disconnectRequested', async (e) => {
    console.log("🔌 Disconnect Requested");
    await client.send('SmartCardEmulation.reportPlainResult', { requestId: e.requestId });
  });
}