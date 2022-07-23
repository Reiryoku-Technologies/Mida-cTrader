/*
 * Copyright Reiryoku Technologies and its contributors, www.reiryoku.com, www.mida.org
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
*/

import {
    MidaPlugin,
    MidaPluginActions,
} from "@reiryoku/mida";
import { CTrader, } from "#platforms/ctrader/CTrader";

export const pluginId: string = "d925e9fe-4352-4391-9a85-f21b2ba6b6d6";
export const pluginVersion: string = "5.0.0";

export class CTraderPlugin extends MidaPlugin {
    public constructor () {
        super({
            id: pluginId,
            name: "cTrader",
            description: "A Mida plugin for using cTrader",
            version: pluginVersion,
        });
    }

    public override install (actions: MidaPluginActions): void {
        actions.addPlatform("cTrader", CTraderPlugin.#platform);
    }

    /* *** *** *** Reiryoku Technologies *** *** *** */

    static readonly #platform: CTrader = new CTrader();

    public static get platform (): CTrader {
        return CTraderPlugin.#platform;
    }
}
