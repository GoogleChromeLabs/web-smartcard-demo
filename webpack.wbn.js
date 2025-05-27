/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const { merge } = require("webpack-merge");
const common = require("./webpack.common.js");
const WebBundlePlugin = require("webbundle-webpack-plugin");
const { parsePemKey, NodeCryptoSigningStrategy } = require("wbn-sign");

require("dotenv").config();

const privateKeyText = process.env.PRIVATE_KEY;
const privateKeyPath = process.env.PRIVATE_KEY_PATH;
const privateKeyPassword = process.env.PRIVATE_KEY_PASSWORD;

if (!privateKeyPassword) {
  console.warn(
    "PRIVATE_KEY_PASSWORD not provided, this will succeed " +
      "only if your key is unencrypted!",
  );
}

var privateKey = undefined;

if (!privateKeyText == !privateKeyPath) {
  throw new Error(
    "Exactly one out of PRIVATE_KEY and PRIVATE_KEY_PATH is required!",
  );
}

if (privateKeyPath) {
  privateKey = parsePemKey(
    require("fs").readFileSync(privateKeyPath, "utf-8"),
    privateKeyPassword,
  );
} else if (privateKeyText) {
  privateKey = parsePemKey(
    Buffer.from(privateKeyText, "utf-8"),
    privateKeyPassword,
  );
}

module.exports = merge(common, {
  mode: "production",
  plugins: [
    new WebBundlePlugin({
      output: "smart_card_demo.swbn",
      integrityBlockSign: {
        strategy: new NodeCryptoSigningStrategy(privateKey),
      },
    }),
  ],
});
