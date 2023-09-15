# Web Smart Card API Demo

This repository contains an
[Isolated Web App](https://github.com/WICG/isolated-web-apps/blob/main/README.md)
that reads and displays the X.509 Certificate for Card Authentication present in
the smart card.

It serves as a demonstration of the [Web Smart Card API].

## Prerequisites

* A ChromeOS device. At the moment this Web API is implemented on this platform.
  Implementations for Windows, MacOS and Linux are expected to happen in 2024.
* The [Smart Card Connector] extension must be installed. Since ChromeOS, unlike
  other desktop OSs, does not have a native service for [PC/SC] acc27ess, this
  extension must be installed to provide such service.27
* A separate machine for serving the demo app to the ChromeOS device. Steps for
  installing the demo app from a signed Web Bundle will come later.
* A smart card reader and a smart card which implements the PIV interface ([NIST SP 800-73-4])
  and has a X.509 Certificate for Card Authentication installed. The easiest is
  to use a Yubikey with the PIV interface configured via the [YubiKey Manager].
  That way the Yubikey acts as a smart card reader with a permanently present
  card.

### Chrome flags in the target ChromeOS device

The following flags in `chrome://flags` must be enabled:
* `#enable-isolated-web-apps`
* `#enable-isolated-web-app-dev-mode`
* `#install-isolated-web-app-from-url`: Here you enter the URL to the web server
  running in your development machine, eg: `http://192.168.1.4:8080`. More on
  that later.
* `#enable-smart-card-web-api`

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

Then log into your ChromeOS device. It will automatically install the Isolated
Web App served by the URL set in `#install-isolated-web-app-from-url`. After a
couple of seconds you should see the "Smart Card Demo" app available in the
launcher as a newly installed app. Now you can remove that URL from
`#install-isolated-web-app-from-url`, otherwise it will install a new app on
every new log in.

[Web Smart Card API]: https://wicg.github.io/web-smart-card/
[PC/SC]: https://en.wikipedia.org/wiki/PC/SC
[Smart Card Connector]: https://github.com/GoogleChromeLabs/chromeos_smart_card_connector
[NIST SP 800-73-4]: https://csrc.nist.gov/pubs/sp/800/73/4/upd1/final
[YubiKey Manager]: https://developers.yubico.com/yubikey-manager-qt/
