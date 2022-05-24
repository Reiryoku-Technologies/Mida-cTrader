import { MidaTrade, MidaTradeParameters, } from "@reiryoku/mida";

export class CTraderTrade extends MidaTrade {
    public constructor (parameters: MidaTradeParameters) {
        super(parameters);
    }
}
