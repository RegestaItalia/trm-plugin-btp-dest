# trm-plugin-btp-dest
Connect TRM to BTP destination

## Requirements
- [trm-client](https://www.npmjs.com/package/trm-client): minimum v5.0.1
- [cf CLI](https://docs.cloudfoundry.org/cf-cli/): used to deploy the SSH enabler app

## Deploy SSH enabler app
This repository contains a build of "trm-ssh", a simplified version of the app that can be found in [jowavp/sap-cf-proxy](https://github.com/jowavp/sap-cf-proxy) repository.

- Download [trm-proxy_0.0.1.mtar](https://github.com/RegestaItalia/trm-plugin-btp-dest/blob/main/trm-ssh/mta_archives/trm-proxy_0.0.1.mtar)
- After logging into the desired Cloud Foundry in BTP using cf cli, execute `cf deploy trm-proxy_0.0.1.mtar`

## Install plugin
To install the plugin, run `npm i trm-plugin-btp-dest -g` and you should now see "BTP" as a destination in trm-client.