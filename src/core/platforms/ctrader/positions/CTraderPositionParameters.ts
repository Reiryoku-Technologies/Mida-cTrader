import { MidaPositionParameters, } from "@reiryoku/mida";
import { CTraderConnection, } from "@reiryoku/ctrader-layer";

export type CTraderPositionParameters = MidaPositionParameters & {
    connection: CTraderConnection;
};
