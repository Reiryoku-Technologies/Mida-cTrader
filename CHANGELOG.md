### Features
* Implement `isSymbolMarketOpen()` interface [#16](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/16)

3.0.1 - 02-06-2022
===================
## Bug fixes
* Set the correct position direction and protection when normalizing a position [#14](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/14)

3.0.0 - 29-05-2022
===================
* **_BREAKING_** Add compatibility with Mida 7

2.1.0 - 11-04-2022
===================
### Features
* Support all cTrader Open API timeframes [#12](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/12)
* Use single source of truth to avoid sending multiple requests for getting pending orders, open positions, equity and account related data [#12](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/12)

2.0.1 - 31-03-2022
===================
### Bug fixes
* Create unique plugin id [#11](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/11)

2.0.0 - 30-03-2022
===================
### Features
* **_BREAKING_** Generic codebase changes and improvements, update major version of Mida [#10](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/10)

### Bug fixes
* Correctly update position orders when a new order impacting the existing position is created [#9](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/9) | https://github.com/Reiryoku-Technologies/Mida-cTrader/issues/7
* Use the correct format when sending a request to update the protection of a position [#9](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/9)

1.2.0 - 28-02-2022
===================
### Features
* Correctly implement the broker account `getOpenPositions` method, return the actual open positions and no longer empty array regardless of open positions ([#3](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/3))
* Update Mida dependency and API usage to 4.0.0 ([#3](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/3))
* Update cTrader Layer dependency and API usage to 2.2.0 ([#3](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/3))
* Optimize cache for assets and symbols ([#3](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/3))

1.1.0 - 27-01-2022
===================
### Features
* Update cTrader Layer to 2.1.0 to support browser usage ([#2](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/2)).

1.0.1 - 20-01-2022
===================
### Bug fixes
* Set correct peer dependency version ([#1](https://github.com/Reiryoku-Technologies/Mida-cTrader/pull/1)).

1.0.0 - 20-01-2022
===================
