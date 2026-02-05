# Web Smart Card API Demo

This repository contains an
[Isolated Web App](https://github.com/WICG/isolated-web-apps/blob/main/README.md)
that reads and displays the X.509 Certificate for Card Authentication present in
a [Personal Identity Verification] (PIV) smart card.

It serves as a demonstration of the [Web Smart Card API].

## Prerequisites

- A ChromeOS device. At the moment this Web API is implemented on this platform.
  There's no implementation of the Web Smart Card API yet for Windows, MacOS or Linux.
- The [Smart Card Connector] extension must be installed (version 1.4.0 or later,
  [web store link](https://chromewebstore.google.com/detail/smart-card-connector/khpfeaanjngmcnplbdlpegiifgpfgdco)).
  Since ChromeOS, unlike other desktop OSs, does not have a native service for
  [PC/SC] access, this extension must be installed to provide such service.
- A separate machine for serving the demo app to the ChromeOS device. Steps for
  installing the demo app from a signed Web Bundle will come later.
- A smart card reader and a smart card which implements the PIV interface ([NIST SP 800-73-4])
  and has a X.509 Certificate for Card Authentication installed. The easiest is
  to use a Yubikey with the PIV interface configured via the [YubiKey Manager].
  That way the Yubikey acts as a smart card reader with a permanently present
  card.

### Chrome flags in the target ChromeOS device

The following flags in `chrome://flags` must be enabled:

- `#enable-isolated-web-app-dev-mode`
- `#enable-smart-card-web-api`

## Building

This project is written in TypeScript and uses npm and Webpack to manage
dependencies and automate the build process. To get started clone the
repository and install dependencies by running,

```sh
npm install
```

Chrome supports two options for Isolated Web App development. In "proxy" mode
you run a local development server as you would for normal web app development
on a URL like `http://localhost:8080`. When the app is installed a random
`isolated-app://` origin is created and the browser proxies requests for this
origin to your local server. This allows you to quickly edit and refresh the
app to see your changes. When developer mode is enabled Chrome also allows you
to self-sign a Web Bundle and load it as it would be for a production app.

When developing an Isolated Web App always make sure you are running the latest
version of Chrome dev-channel as the feature is under active development.

### Running with a development server

To start a local development server run,

```sh
npm run start
```

Then log into your ChromeOS device, go to `chrome://web-app-internals/`, put
the server url in the text box labeled `Install IWA via Dev Mode Proxy:` and
press the `Install` button. After a couple of seconds you should see the "Smart
Card Demo" app available in the launcher as a newly installed app.

### Building a Signed Web Bundle using a locally stored key

To build a signed web bundle from this and sign it using a locally stored key,
you have to generate appropriate signing keys - instructions on how to can be found in
[this article](https://chromeos.dev/en/tutorials/getting-started-with-isolated-web-apps/2).
The key (or its path) and password (optional, if your key is encrypted) need to be passed via
environment variables. One way to do it is to create `.env` file in the repository root with
the following contents (replace `...` with actual values), it will be automatically sourced:

```sh
# Use either PRIVATE_KEY or PRIVATE_KEY_PATH, not both!
PRIVATE_KEY="..."
PRIVATE_KEY_PATH="..."
PRIVATE_KEY_PASSWORD="..."
```

When this is ready, run

```sh
npm run build
```

If you are correctly authenticated for the purpose of [GCP KMS Node.js client],
the ready bundle will appear in `dist/smart_card_demo.swbn`.

### Building a Signed Web Bundle using a key stored in GCP KSM

To build a signed web bundle from this and sign it with a signing key within
your Google Cloud project using [wbn-sign-gcp-kms], create `.env` file in the
repository root with the following contents (replace `...` with actual values):

```sh
GCP_PROJECT='...'
GCP_KEY_RING='...'
GCP_KEY='...'
GCP_LOCATION='...'
GCP_KEY_VERSION='...'
```

and run

```sh
npm run build-gcp-kms
```

if you are correctly authenticated for the purpose of [GCP KMS Node.js client],
the ready bundle will appear in `dist/smart_card_demo.swbn`.

## 🧪 Automated Testing (Emulation)
Smart Card Emulation (Chrome version >= 146.0.7667.0) enables a remote debugging workflow. 
You launch Chrome (the Host) with specific debugging flags, and a Node.js test script (the Client) connects to it via the DevTools Protocol to automatically install the app, launch it, and drive the emulation.

### Step 1: Launch the Host (Chrome)

You need a Chrome instance listening on port 9222 with PWA debugging enabled.

#### Option A: Local Chromium Build
Run your custom Chrome binary.
```bash
~/chrome/src/out/current_link/chrome \
  --remote-debugging-port=9222 \
  --enable-features=IsolatedWebApps,IsolatedWebAppDevMode \
  --enable-devtools-pwa-handler \
  --system-developer-mode
```

#### Option B: Physical ChromeOS Device (DUT)
Configure the DUT via SSH to allow remote debugging and PWA control.

1. SSH into the DUT with Port Forwarding Use the following command to connect to your DUT. 
This forwards the remote debugging port (9222) to your machine and your local dev server (8080) to the DUT.
```bash
ssh -L 9222:localhost:9222 -R 8080:localhost:8080 root@<DUT_IP_ADDRESS>
```

2. Configure Chrome Flags Once logged into the DUT, edit /etc/chrome_dev.conf to enable the required features:
```bash
echo "--remote-debugging-port=9222" >> /etc/chrome_dev.conf
echo "--enable-features=IsolatedWebApps,IsolatedWebAppDevMode" >> /etc/chrome_dev.conf
echo "--enable-devtools-pwa-handler" >> /etc/chrome_dev.conf
```

3. Restart the UI Apply the changes by restarting the ChromeOS UI:
```
restart ui
```

Keep the SSH session open. This maintains the tunnel that allows the test script to talk to the DUT.

### Step 2: Run the Test Runner
Once Chrome is listening on localhost:9222 (via the SSH tunnel or locally), run the test script.

Note: If testing on a physical DUT, ensure the .swbn file is copied to the device at the same path expected by the script, or update the script to point to the file location on the DUT.

```Bash
node tests/test-demo.js
```

[Web Smart Card API]: https://wicg.github.io/web-smart-card/
[PC/SC]: https://en.wikipedia.org/wiki/PC/SC
[Smart Card Connector]: https://github.com/GoogleChromeLabs/chromeos_smart_card_connector
[NIST SP 800-73-4]: https://csrc.nist.gov/pubs/sp/800/73/4/upd1/final
[Personal Identity Verification]: https://en.wikipedia.org/wiki/FIPS_201
[YubiKey Manager]: https://developers.yubico.com/yubikey-manager-qt/
[wbn-sign-gcp-kms]: https://github.com/chromeos/wbn-sign-gcp-kms
[GCP KMS Node.js client]: https://cloud.google.com/nodejs/docs/reference/kms/latest
