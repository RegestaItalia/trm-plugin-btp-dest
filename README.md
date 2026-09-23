# trm-plugin-btp-dest

Connect TRM to a BTP destination.

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
 │  └──────────────────────┘         │ + trm-server (REST)  │  │
 │                                   └──────────────────────┘  │
 └─────────────────────────────────────────────────────────────┘
```

1. The plugin logs into Cloud Foundry and looks for the **trm-ssh** app
2. It opens an SSH tunnel to the app and forwards the Connectivity service proxy ports to the local machine
3. TRM calls the SAP system through the chosen BTP destination (proxy type `OnPremise`); the Connectivity service and the Cloud Connector route each call to the on-premise system

The connection is currently **REST only** (HTTP through the destination, no RFC), so **trm-server must be installed on the target SAP system** to expose the REST endpoints TRM uses.

## Requirements

- [trm-client](https://www.npmjs.com/package/trm-client): minimum v11.3.0
- [cf CLI](https://docs.cloudfoundry.org/cf-cli/): used to deploy the SSH enabler app
- SAP Cloud Connector connecting the on-premise SAP system to the BTP subaccount
- A BTP destination (proxy type `OnPremise`) pointing to the SAP system
- trm-server installed on the target SAP system

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
| `cfRegion`         | Cloud Foundry region (e.g. `eu10`); when set, global account and subaccount are skipped |
| `btpGlobalAccount` | Global account subdomain or display name (only without `cfRegion`)                   |
| `btpSubaccount`    | Subaccount subdomain, id, technical name or display name (only without `cfRegion`)   |
| `btpDestination`   | Name of the destination (proxy type `OnPremise`)                                     |
| `forwardRfcDest`   | RFC destination trm-rest forwards calls to, same as client option `-x <destination>`; prompted when missing, `NONE` when `--connection-type` is used |

Arguments not provided are prompted as usual. In CI the user must be able to log in with email and password (no two-factor authentication).
