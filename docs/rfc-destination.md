# RFC destinations through trm-ssh (Option A)

Status: **not feasible today**. This document explains why and what would need to change first.

## Goal

Let the target SAP system skip **trm-rest** and only have **trm-server** (which exposes RFC-enabled function modules, `/ATRM/*`).

```
trm-client + plugin ──REST──▶ trm-ssh (CF) ──RFC (JCo)──▶ Connectivity ──▶ Cloud Connector ──▶ SAP + trm-server
```

- The plugin keeps talking REST to the trm-ssh instance.
- trm-ssh, for a destination of type `RFC` (proxy type `OnPremise`), converts the request into an RFC call and runs it through SAP JCo (SAP Java Buildpack, the only runtime SAP supports for RFC from Cloud Foundry via Cloud Connector).
- `HTTP` destinations keep working as today. trm-ssh currently serves no HTTP itself: it is only the SSH jump host, the plugin forwards the Connectivity proxy ports through `cf ssh` and calls the destination from the client. The RFC endpoint would be the first HTTP service trm-ssh exposes, reached through the same SSH tunnel.

### Requirement: a generic mapper

trm-ssh must contain **no knowledge of the TRM APIs**: no list of endpoints, no endpoint → function module table, no per-API parameter mapping. When a new API is added to trm-core / trm-server, trm-ssh must not need a new release, and customers must not have to redeploy the `.mtar`.

In other words, each request that reaches trm-ssh must already carry everything needed to execute it as RFC: the function module name and its parameters.

## Why it is not possible today

The plugin plugs into trm-core as a REST client (`CfClient extends Core.RESTClient`), so what reaches trm-ssh is a **trm-rest request**. trm-rest is not a 1:1 projection of the trm-server function modules, so a trm-rest request cannot be translated to an RFC call mechanically. Examples from trm-core (`RESTClient` vs `RFCClient`):

### 1. Endpoint names do not map to function module names

Most endpoints look derivable (`/create_toc` → `/ATRM/CREATE_TOC`), but not all:

| trm-rest endpoint        | Function module              |
| ------------------------ | ---------------------------- |
| `/create_toc`            | `/ATRM/CREATE_TOC`           |
| `/read_table`            | `RFC_READ_TABLE`             |
| `/repository_environment`| `REPOSITORY_ENVIRONMENT_RFC` |
| `/version`               | `/ATRM/VERSION`              |

There is no rule trm-ssh could apply without a lookup table.

### 2. Response shapes differ

The same logical call returns different field names:

| Method                 | trm-rest response field | RFC export  |
| ---------------------- | ----------------------- | ----------- |
| `getTrmServerVersion`  | `serverVersion`         | `version`   |
| `getTrmRestVersion`    | `restVersion`           | `rest`      |

trm-core reads the REST field name, so trm-ssh would have to rename exports per API.

### 3. Binary transfer uses HTTP-specific encodings

- `writeBinaryFile`: REST sends `multipart/form-data` (`file` + `file_path`); RFC passes `file` as an XSTRING parameter.
- `getBinaryFile`: REST returns a raw `arraybuffer` body; RFC returns the `file` export.
- `executePostActivity` and `getAbapgitSource` also rely on multipart bodies and response headers.

A generic mapper cannot know which multipart part corresponds to which ABAP parameter, or which export must be returned as a raw body.

### 4. Parameters that only exist in REST

Some REST calls carry parameters that are not function module parameters, e.g. `rfcdest` as a query parameter on `/read_table`, `/repository_environment`, `/get_dest`. Parameters also arrive in different places depending on the verb (query string, JSON body, body on `GET`/`DELETE`), so trm-ssh cannot tell which of them are ABAP importing parameters.

### 5. Error contract differs

- trm-rest returns `{ message: { msgid, msgno, msgv1..4 }, log }` and some errors as plain messages (`e.message === 'TABLE_WITHOUT_DATA'`).
- RFC raises `abapMsgClass`, `abapMsgNumber`, `abapMsgV1..4` and exceptions (`e.exceptionType === 'TABLE_WITHOUT_DATA'`).

trm-core's `RESTClient` parses the trm-rest format, so trm-ssh would have to rebuild it, including per-API special cases.

### Conclusion

Every one of these points needs API-specific knowledge in trm-ssh, which is exactly what the requirement rules out. Converting trm-rest requests to RFC means re-implementing trm-rest inside trm-ssh and keeping it in sync with every trm-core release.

## What would make it possible

The only component that knows the function module name and the ABAP parameter names for each API is trm-core's `RFCClient`: every method ends in `_call(fm, params)`. If the plugin sent **that** call over REST instead of a trm-rest request, the mapper in trm-ssh could be fully generic:

```
POST /rfc
{ "fm": "/ATRM/CREATE_TOC", "params": { "TEXT": "...", "TARGET": "..." } }

200 { "TRKORR": "..." }
4xx { "exception": "...", "message": { "msgid": "...", "msgno": "...", "msgv1": "...", ... } }
```

trm-ssh would read the function metadata from JCo, map `params` onto it, execute, and serialize exports/tables/changing parameters back to JSON. A new API in trm-core would work through BTP with no change to trm-ssh or the plugin.

Changes required:

- **trm-core**: make `RFCClient._call` `protected` (it is `private` in the typings today) or expose a transport hook, so a subclass can replace the node-rfc call.
- **Plugin**: add a client that extends `RFCClient` and overrides `open`, `close`, `checkConnection` and `_call`. node-rfc is loaded lazily in `getRfcClient()`, so overriding these keeps the client free of node-rfc and the NW RFC SDK (pure JS, suitable for CI runners). The plugin picks this client for `RFC` destinations and keeps `CfClient` for `HTTP` destinations.
- **trm-ssh**: rewrite as a Java app on the SAP Java Buildpack (JCo is provided by the buildpack, nothing to redistribute), exposing the generic `/rfc` endpoint (reached through the SSH tunnel; the current 128M memory quota must be raised for a JVM and for binary payloads). The error payload must carry enough for `RFCClient`'s error parsing (message class/number/variables, exception type).

### Open points

- **Payload size**: binary files go through JSON (base64), so trm-ssh needs appropriate request size limits and timeouts.
- **Logon**: RFC destination with user/password, or principal propagation via JCo.
- **Cloud Connector**: an `RFC` system mapping lets admins allowlist the function modules (`/ATRM/*`, `RFC_READ_TABLE`, `REPOSITORY_ENVIRONMENT_RFC`, ...).
