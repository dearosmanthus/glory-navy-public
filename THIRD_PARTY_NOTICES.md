# Third-party data and dependencies

EVE Online names, trademarks, game data and images belong to CCP hf. This is an independent player utility and is not an official CCP product. Game catalogs are derived from the [CCP Static Data Export](https://developers.eveonline.com/static-data). Public API data are obtained from ESI and Fuzzwork; game icons use CCP's image service.

Preserve source/version records when updating game data. Current scan input/output hashes are recorded in `data/scan-data-provenance.json`; remaining provenance gaps are documented in `docs/handoff.md`. Reference websites informed feature behavior; their source and assets are not supplied as this project's implementation.

JavaScript dependencies are identified by `package.json` and `package-lock.json`. Each dependency retains its upstream license; installation obtains the package's accompanying license text. `node_modules/` is not included in this repository.

The project owner has not selected an open-source license for original project code. Repository access does not grant rights to relicense CCP data, dependency code or other third-party assets.
