import {
    MidaEmitter,
    MidaOrderParameters,
    MidaProtectionDirectives,
} from "@reiryoku/mida";
import { CTraderConnection, } from "@reiryoku/ctrader-layer";

export type CTraderOrderParameters = MidaOrderParameters & {
    uuid: string;
    connection: CTraderConnection;
    cTraderEmitter: MidaEmitter;
    requestedProtection?: MidaProtectionDirectives;
};
