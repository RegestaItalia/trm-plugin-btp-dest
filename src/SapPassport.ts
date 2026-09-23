import axios from "axios";
import { Agent } from "https";
import { existsSync, readFileSync } from "fs";
import { getErrorReason } from "./errors";

// SAP Passport (client certificate, .pfx) used to authenticate at SAP ID service (accounts.sap.com)
// as a browser would: follows redirects keeping cookies, the certificate is presented on TLS handshake
export class SapPassport {

    private _agent: Agent;
    private _cookies: { [host: string]: { [name: string]: string } } = {};

    // passport: path to the .pfx file or its base64 content
    constructor(passport: string, passphrase?: string) {
        var pfx: Buffer;
        try {
            pfx = existsSync(passport) ? readFileSync(passport) : Buffer.from(passport, 'base64');
        } catch (e) {
            throw new Error(`Couldn't read SAP Passport (${getErrorReason(e)}).`);
        }
        this._agent = new Agent({ pfx, passphrase });
    }

    // new browser session (no cookies), same certificate
    public reset(): void {
        this._cookies = {};
    }

    // GET following redirects, returns the final page
    public async browse(url: string): Promise<{ url: string, body: string }> {
        for (var i = 0; i < 20; i++) {
            var response;
            try {
                response = await axios.get(url, {
                    httpsAgent: this._agent,
                    maxRedirects: 0,
                    responseType: 'text',
                    validateStatus: (s) => s < 400,
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml',
                        'Cookie': this.getCookies(url)
                    }
                });
            } catch (e) {
                const reason = getErrorReason(e);
                if (/mac verify failure|bad decrypt|pkcs12|asn1|unsupported/i.test(reason)) {
                    throw new Error(`Couldn't open SAP Passport: wrong passphrase or not a valid .pfx file (${reason}).`);
                }
                throw new Error(`SAP Passport login failed at ${new URL(url).host} (${reason}).`);
            }
            this.setCookies(url, response.headers['set-cookie']);
            if (response.status >= 300 && response.headers.location) {
                url = new URL(response.headers.location, url).toString();
                continue;
            }
            return { url, body: String(response.data) };
        }
        throw new Error(`SAP Passport login failed: too many redirects.`);
    }

    private getCookies(url: string): string {
        return Object.entries(this._cookies[new URL(url).host] || {}).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    private setCookies(url: string, setCookie?: string[]): void {
        const host = new URL(url).host;
        const cookies = this._cookies[host] = this._cookies[host] || {};
        (setCookie || []).forEach(c => {
            const pair = c.split(';')[0];
            const i = pair.indexOf('=');
            if (i > 0) {
                cookies[pair.substring(0, i).trim()] = pair.substring(i + 1);
            }
        });
    }

}
