# trm-plugin-btp-dest

Connect TRM to a BTP destination.

Full setup guide (Cloud Connector, destination, trm-ssh app, BTP user): [Connect through SAP BTP](https://docs.trmregistry.com/client/btp_destination/) in the TRM documentation.

## Why use this connector

TRM normally needs a direct network route to the target SAP system (RFC or HTTP). That is often not available:

- **CI/CD pipelines** (GitHub Actions, Azure DevOps, GitLab runners, ...) run on cloud-hosted agents that cannot reach systems inside the corporate network
- Opening firewall ports or setting up a VPN just for TRM to connect is not always an option

If your on-premise SAP system is already connected to SAP BTP through the **SAP Cloud Connector**, this plugin lets TRM reuse that secure tunnel: any machine that can reach SAP BTP over the internet can reach the SAP system, without exposing it or changing network configuration.

## How it works

```
 ┌─────────────────────────┐
 │ trm-client              │  local machine / CI runner
 │ + trm-plugin-btp-dest   │
 └───────────┬─────────────┘
             │ 1. Cloud Foundry login (API)
             │ 2. SSH tunnel (cf ssh endpoint)
             ▼
 ┌──────────────────────────────── SAP BTP (Cloud Foundry) ───┐
 │  ┌─────────────┐  3. REST calls    ┌──────────────────────┐ │
 │  │ trm-ssh app │ ────────────────▶ │ Connectivity service │ │
 │  └─────────────┘  via destination  └──────────┬───────────┘ │
 └───────────────────────────────────────────────┼─────────────┘
                                                 │ secure tunnel
                                                 ▼
 ┌──────────────────────────────── On-premise ─────────────────┐
 │  ┌──────────────────────┐  HTTP   ┌──────────────────────┐  │
 │  │ SAP Cloud Connector  │ ──────▶ │ SAP system           │  │
 │  └──────────────────────┘         │ trm-rest (REST API)  │  │
 │                                   │     │                │  │
 │                                   │     ▼                │  │
 │                                   │ trm-server           │  │
 │                                   └──────────────────────┘  │
 └─────────────────────────────────────────────────────────────┘
```

1. The plugin logs into Cloud Foundry and looks for the **trm-ssh** app
2. It opens an SSH tunnel to the app and forwards the Connectivity service proxy ports to the local machine
3. TRM calls the SAP system through the chosen BTP destination (proxy type `OnPremise`); the Connectivity service and the Cloud Connector route each call to the on-premise system
4. On the SAP system, **trm-rest** receives the HTTP calls

The connection is currently **REST only** (HTTP through the destination, no RFC).

## Requirements

- [trm-client](https://www.npmjs.com/package/trm-client): minimum v11.3.0
- [cf CLI](https://docs.cloudfoundry.org/cf-cli/): used to deploy the SSH enabler app
- SAP Cloud Connector connecting the on-premise SAP system to the BTP subaccount
- A BTP destination (proxy type `OnPremise`) pointing to the SAP system
- trm-server and trm-rest installed on the target SAP system

## Deploy SSH enabler app

This repository contains a build of "trm-ssh", a simplified version of the app that can be found in [jowavp/sap-cf-proxy](https://github.com/jowavp/sap-cf-proxy) repository.

- Download [trm-proxy_0.0.1.mtar](https://github.com/RegestaItalia/trm-plugin-btp-dest/blob/main/trm-ssh/mta_archives/trm-proxy_0.0.1.mtar)
- After logging into the desired Cloud Foundry in BTP using cf cli, execute `cf deploy trm-proxy_0.0.1.mtar`

## Install plugin

To install the plugin, run `npm i trm-plugin-btp-dest -g` and you should now see "BTP" as a destination in your TRM client.

## Non-interactive usage (CI/CD)

Every prompt can be skipped by passing connection arguments from the TRM client:

- `--connection-type BTP` (or env `TRM_CONNECTION_TYPE`) selects this connection
- `--connection-args <JSON or path to JSON file>` (or env `TRM_CONNECTION_ARGS`) passes the arguments below

| Argument           | Description                                                                          |
| ------------------ | ------------------------------------------------------------------------------------ |
| `btpEmail`         | BTP user email                                                                       |
| `btpPassword`      | BTP user password                                                                    |
| `btpPassport`      | SAP Passport (`.pfx`) file path or base64 content, replaces `btpEmail` and `btpPassword` (env `TRM_SAP_PASSPORT`) |
| `btpPassportPassphrase` | SAP Passport passphrase (env `TRM_SAP_PASSPORT_PASSPHRASE`); prompted when missing, none with `--no-prompts` |
| `cfRegion`         | Cloud Foundry region (e.g. `eu10`); when set, global account and subaccount are skipped |
| `btpGlobalAccount` | Global account subdomain or display name (only without `cfRegion`)                   |
| `btpSubaccount`    | Subaccount subdomain, id, technical name or display name (only without `cfRegion`)   |
| `btpDestination`   | Name of the destination (proxy type `OnPremise`)                                     |
| `forwardRfcDest`   | RFC destination trm-rest forwards calls to, same as client option `-x <destination>`; `NONE` (default) for no forward. Prompted when missing, `NONE` when `--connection-type` or `--no-prompts` is used |

Arguments not provided are prompted as usual. With `--no-prompts` nothing is prompted: a missing required argument stops the command with an error naming it. Required are:

- the BTP login: `btpEmail` and `btpPassword`, or `btpPassport`
- `cfRegion`, or `btpGlobalAccount` and `btpSubaccount`
- `btpDestination`

In CI the user must be able to log in with email and password (no two-factor authentication), or with a SAP Passport. Use `cfRegion` when possible: it's shown in the subaccount overview of the BTP cockpit (`cf-eu10` means `eu10`), and it skips the BTP login used only to read global accounts and subaccounts.

Example:

```sh
export TRM_CONNECTION_TYPE=BTP
export TRM_CONNECTION_ARGS='{"btpEmail":"trm-ci@example.com","btpPassword":"secret","cfRegion":"eu10","btpDestination":"SAP_DEV","forwardRfcDest":"NONE"}'
trm install <package> --no-prompts
```

### GitHub Actions

The plugin is installed with npm next to the TRM client, in the same `npm install -g` step. The connection arguments come from repository secrets (`BTP_EMAIL`, `BTP_PASSWORD`); `toJSON(...)` quotes each secret as a JSON string.

```yaml
jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install TRM client and BTP plugin
        run: npm install -g trm-client trm-plugin-btp-dest

      - name: Install package
        env:
          TRM_CONNECTION_TYPE: BTP
          TRM_CONNECTION_ARGS: >-
            {"cfRegion": "eu10", "btpDestination": "SAP_DEV", "forwardRfcDest": "NONE",
            "btpEmail": ${{ toJSON(secrets.BTP_EMAIL) }},
            "btpPassword": ${{ toJSON(secrets.BTP_PASSWORD) }}}
        run: trm install <package> --no-prompts -E public
```

To log in with a SAP Passport instead, store the base64 content of the `.pfx` file and its passphrase as secrets, set them as `TRM_SAP_PASSPORT` and `TRM_SAP_PASSPORT_PASSPHRASE` in `env`, and leave `btpEmail` and `btpPassword` out of `TRM_CONNECTION_ARGS`.

More on running TRM in pipelines (registry authentication, publishing): [GitHub Actions](https://docs.trmregistry.com/commons/github_actions/) in the TRM documentation.

### SAP Passport

A SAP Passport (client certificate issued by SAP, `.pfx`) can be used instead of email and password: when `btpPassport` is set, email and password are not asked and the login to BTP and Cloud Foundry is done with the certificate at the SAP ID service (same as `btp login --sso` and `cf login --sso` in a browser with the passport installed).

```sh
export TRM_SAP_PASSPORT=/path/to/passport.pfx   # or its base64 content, e.g. from a CI secret
export TRM_SAP_PASSPORT_PASSPHRASE=...
trm <command> --connection-type BTP --connection-args '{"cfRegion":"eu10","btpDestination":"MY_DEST"}'
```

The passport is never saved with the connection data: when the saved Cloud Foundry session expires, it is read again from the arguments/environment (or email and password are prompted).
