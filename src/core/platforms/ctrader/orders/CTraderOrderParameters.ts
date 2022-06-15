import {
    MidaEmitter,
    MidaOrderParameters,
    MidaProtection,
} from "@reiryoku/mida";
import { CTraderConnection, } from "@reiryoku/ctrader-layer";

export type CTraderOrderParameters = MidaOrderParameters & {
    uuid: string;
    connection: CTraderConnection;
    cTraderEmitter: MidaEmitter;
    requestedProtection?: MidaProtection;
};
