/**
 * Copyright 2024 Google LLC
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
const { GCPWbnSigner } = require("wbn-sign-gcp-kms");

require("dotenv").config();

const gcpProject = process.env.GCP_PROJECT;
const gcpLocation = process.env.GCP_LOCATION;
const gcpKeyRing = process.env.GCP_KEY_RING;
const gcpKey = process.env.GCP_KEY;
const gcpKeyVersion = process.env.GCP_KEY_VERSION;

if (!gcpProject || !gcpLocation || !gcpKeyRing || !gcpKey || !gcpKeyVersion) {
  throw new Error("GCP key related environment variables must be set.");
}

module.exports = merge(common, {
  mode: "production",
  plugins: [
    new WebBundlePlugin({
      output: "smart_card_demo.swbn",
      integrityBlockSign: {
        strategy: new GCPWbnSigner({
          project: gcpProject,
          location: gcpLocation,
          keyring: gcpKeyRing,
          key: gcpKey,
          version: gcpKeyVersion,
        }),
      },
    }),
  ],
});
