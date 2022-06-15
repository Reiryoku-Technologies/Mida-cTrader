import {
    GenericObject, MidaEmitter,
    MidaOrder,
    MidaOrderDirection,
    MidaPosition,
    MidaPositionDirection,
    MidaPositionStatus,
    MidaProtection,
    MidaProtectionChange,
    MidaProtectionChangeStatus,
    MidaUtilities,
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
    readonly #protectionChangeRequests: Map<string, [ MidaProtection, Function, ]>;

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

    public override async getUsedMargin (): Promise<number> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return 0;
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return Number(plainPosition.usedMargin) / 100;
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

    public override async getUnrealizedSwap (): Promise<number> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return 0;
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return Number(plainPosition.swap) / 100;
    }

    public override async getUnrealizedCommission (): Promise<number> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return 0;
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return Number(plainPosition.commission) / 100 * 2;
    }

    public override async getUnrealizedGrossProfit (): Promise<number> {
        if (this.status === MidaPositionStatus.CLOSED) {
            return 0;
        }

        const plainPosition: GenericObject = this.#cTraderTradingAccount.getPlainPositionById(this.id) as GenericObject;

        return this.#cTraderTradingAccount.getPlainPositionGrossProfit(plainPosition);
    }

    public override async changeProtection (protection: MidaProtection): Promise<MidaProtectionChange> {
        const requestDescriptor: GenericObject = {
            positionId: this.id,
            stopLoss: this.stopLoss,
            takeProfit: this.takeProfit,
            trailingStopLoss: this.trailingStopLoss,
        };

        if ("stopLoss" in protection) {
            requestDescriptor.stopLoss = protection.stopLoss;
        }

        if ("takeProfit" in protection) {
            requestDescriptor.takeProfit = protection.takeProfit;
        }

        if ("trailingStopLoss" in protection) {
            requestDescriptor.trailingStopLoss = protection.trailingStopLoss;
        }

        const uuid: string = MidaUtilities.uuid();
        const protectionChangePromise: Promise<MidaProtectionChange> = new Promise((resolver: Function) => {
            this.#protectionChangeRequests.set(uuid, [ protection, resolver, ]);
        });

        this.#sendCommand("ProtoOAAmendPositionSLTPReq", requestDescriptor, uuid);

        return protectionChangePromise;
    }

    // eslint-disable-next-line max-lines-per-function
    async #onUpdate (descriptor: GenericObject): Promise<void> {
        if (this.#updateEventIsLocked) {
            this.#updateEventQueue.push(descriptor);

            return;
        }

        this.#updateEventIsLocked = true;

        const plainOrder: GenericObject = descriptor.order;
        const positionId: string = plainOrder?.positionId?.toString();
        const messageId: string = descriptor.clientMsgId;

        if (positionId && positionId === this.id) {
            switch (descriptor.executionType) {
                case "SWAP": {
                    // TODO: pass the real quantity
                    this.onSwap(NaN);

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
                    this.onTradeExecute(await this.#cTraderTradingAccount.normalizeTrade(descriptor.deal));

                    break;
                }
            }
        }

        // Process next event if there is any
        const nextDescriptor: GenericObject | undefined = this.#updateEventQueue.shift();
        this.#updateEventIsLocked = false;

        if (nextDescriptor) {
            this.#onUpdate(nextDescriptor);
        }
        else if (descriptor?.position?.positionStatus.toUpperCase() === "POSITION_STATUS_CLOSED") {
            this.#removeEventsListeners();
        }
    }

    #configureListeners (): void {
        this.#updateEventUuid = this.#cTraderEmitter.on("execution", (event): void => {
            const descriptor: GenericObject = event.descriptor.descriptor;

            if (descriptor.ctidTraderAccountId.toString() === this.#brokerAccountId) {
                this.#onUpdate(descriptor); // Not using await is intended
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
