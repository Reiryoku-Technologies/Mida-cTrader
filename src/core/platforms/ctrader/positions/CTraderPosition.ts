import {
    decimal,
    GenericObject, MidaDecimal, MidaEmitter,
    MidaOrder,
    MidaOrderDirection,
    MidaPosition,
    MidaPositionDirection,
    MidaPositionStatus,
    MidaProtection,
    MidaProtectionChange,
    MidaProtectionChangeStatus, MidaProtectionDirectives,
    uuid,
} from "@reiryoku/mida";
import { CTraderPositionParameters, } from "#platforms/ctrader/positions/CTraderPositionParameters";
import { CTraderConnection, } from "@reiryoku/ctrader-layer";
import { CTraderAccount, } from "#platforms/ctrader/CTraderAccount";

export class CTraderPosition extends MidaPosition {
    readonly #connection: CTraderConnection;
    readonly #cTraderEmitter: MidaEmitter;
    readonly #updateEventQueue: GenericObject[];
    #updateEventIsLocked: boolean;
    #updateEventUuid?: string;
    readonly #protectionChangeRequests: Map<string, [ MidaProtectionDirectives, Function, ]>;

    public constructor ({
        id,
        symbol,
        tradingAccount,
        volume,
        direction,
        protection,
        connection,
        cTraderEmitter,
    }: CTraderPositionParameters) {
        super({
            id,
            symbol,
            volume,
            direction,
            tradingAccount,
            protection,
        });

        this.#connection = connection;
        this.#cTraderEmitter = cTraderEmitter;
        this.#updateEventQueue = [];
        this.#updateEventIsLocked = false;
        this.#updateEventUuid = undefined;
        this.#protectionChangeRequests = new Map();

        this.#configureListeners();
    }

    get #cTraderTradingAccount (): CTraderAccount {
        return this.tradingAccount as CTraderAccount;
    }

    get #brokerAccountId (): string {
        return this.#cTraderTradingAccount.brokerAccountId;
    }

    public override async getUsedMargin (): Promise<MidaDecimal> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return decimal(0);
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return decimal(plainPosition.usedMargin).divide(100);
    }

    public override async addVolume (volume: number): Promise<MidaOrder> {
        return this.tradingAccount.placeOrder({
            positionId: this.id,
            direction: this.direction === MidaPositionDirection.LONG ? MidaOrderDirection.BUY : MidaOrderDirection.SELL,
            volume: volume,
        });
    }

    public override async subtractVolume (volume: number): Promise<MidaOrder> {
        return this.tradingAccount.placeOrder({
            positionId: this.id,
            direction: this.direction === MidaPositionDirection.LONG ? MidaOrderDirection.SELL : MidaOrderDirection.BUY,
            volume: volume,
        });
    }

    public override async getUnrealizedSwap (): Promise<MidaDecimal> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return decimal(0);
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return decimal(plainPosition.swap).divide(100);
    }

    public override async getUnrealizedCommission (): Promise<MidaDecimal> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return decimal(0);
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return decimal(plainPosition.commission).divide(100).multiply(2);
    }

    public override async getUnrealizedGrossProfit (): Promise<MidaDecimal> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return decimal(0);
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return this.#cTraderTradingAccount.getPlainPositionGrossProfit(plainPosition);
    }

    public override async changeProtection (protection: MidaProtectionDirectives): Promise<MidaProtectionChange> {
        const requestDescriptor: GenericObject = {
            positionId: this.id,
            stopLoss: this.stopLoss,
            takeProfit: this.takeProfit,
            trailingStopLoss: this.trailingStopLoss,
        };

        if ("stopLoss" in protection) {
            requestDescriptor.stopLoss = decimal(protection.stopLoss);
        }

        if ("takeProfit" in protection) {
            requestDescriptor.takeProfit = decimal(protection.takeProfit);
        }

        if ("trailingStopLoss" in protection) {
            requestDescriptor.trailingStopLoss = protection.trailingStopLoss === true;
        }

        const id: string = uuid();
        const protectionChangePromise: Promise<MidaProtectionChange> = new Promise((resolver: Function) => {
            this.#protectionChangeRequests.set(id, [ protection, resolver, ]);
        });

        this.#sendCommand("ProtoOAAmendPositionSLTPReq", requestDescriptor, id);

        return protectionChangePromise;
    }

    #onUpdate (descriptor: GenericObject): void {
        const plainOrder: GenericObject = descriptor.order;
        const positionId: string = plainOrder?.positionId?.toString();
        const messageId: string = descriptor.clientMsgId;

        console.log(222);

        if (positionId && positionId === this.id) {
            switch (descriptor.executionType) {
                case "SWAP": {
                    // TODO: pass the real quantity
                    this.onSwap(decimal(0));

                    break;
                }
                case "ORDER_ACCEPTED":
                case "ORDER_REPLACED": {
                    if (plainOrder.orderType === "STOP_LOSS_TAKE_PROFIT") {
                        this.onProtectionChange(this.#cTraderTradingAccount.normalizeProtection(descriptor.position));

                        const protectionChangeRequest: any[] | undefined = this.#protectionChangeRequests.get(messageId);

                        if (protectionChangeRequest) {
                            protectionChangeRequest[1]({
                                status: MidaProtectionChangeStatus.SUCCEEDED,
                                requestedProtection: protectionChangeRequest[0],
                            });
                        }
                    }

                    break;
                }
                case "ORDER_PARTIAL_FILL":
                case "ORDER_FILLED": {
                    this.onTrade(this.#cTraderTradingAccount.normalizeTrade(descriptor.deal));

                    break;
                }
            }
        }

        if (descriptor?.position?.positionStatus.toUpperCase() === "POSITION_STATUS_CLOSED") {
            this.#removeEventsListeners();
        }
    }

    #configureListeners (): void {
        this.#updateEventUuid = this.#cTraderEmitter.on("execution", (event): void => {
            const descriptor: GenericObject = event.descriptor.descriptor;

            if (descriptor.ctidTraderAccountId.toString() === this.#brokerAccountId) {
                this.#onUpdate(descriptor);
            }
        });
    }

    #removeEventsListeners (): void {
        if (this.#updateEventUuid) {
            this.#cTraderEmitter.removeEventListener(this.#updateEventUuid);

            this.#updateEventUuid = undefined;
        }
    }

    async #sendCommand (payloadType: string, parameters?: GenericObject, messageId?: string): Promise<GenericObject> {
        return this.#connection.sendCommand(payloadType, {
            ctidTraderAccountId: this.#brokerAccountId,
            ...parameters ?? {},
        }, messageId);
    }
}
