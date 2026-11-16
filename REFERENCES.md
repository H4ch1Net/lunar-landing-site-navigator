# References

Every dataset, paper, library, font and design resource used by Lunar Landing Site Navigator.

## Challenge
- NASA Space Apps Challenge 2026, "Lunar Landing Site Navigator": https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/

## Ephemeris
- NASA NAIF SPICE toolkit and generic kernels: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ (de440s.bsp, moon_pa_de440_200625.bpc, moon_de440_250416.tf, pck00011.tpc, latest_leapseconds.tls)
- SpiceyPy: https://github.com/AndrewAnnex/SpiceyPy (Annex et al. 2020, JOSS 5(46), 2050)
- JPL Horizons System, used to validate Sun and Earth positions: https://ssd.jpl.nasa.gov/horizons/ (API: https://ssd-api.jpl.nasa.gov/doc/horizons.html)

## Terrain and illumination
- NASA LRO LOLA south pole elevation models, NASA GSFC PGDA product 90: https://pgda.gsfc.nasa.gov/products/90 . Barker, M. K. et al. 2023, Planetary Science Journal 4, 183, https://doi.org/10.3847/PSJ/acf3e1 ; data https://doi.org/10.60903/gsfcpgda-lola-spole . Files: LDEM_80S_20MPP_ADJ, LDEM_80S_80MPP_ADJ, LDEM_60S_240MPP_ADJ.
- NASA LRO LOLA lunar polar illumination maps, NASA GSFC PGDA product 69: https://pgda.gsfc.nasa.gov/products/69 . Mazarico, E. et al. 2011, Icarus 211, 1066-1081, https://doi.org/10.1016/j.icarus.2010.10.030 . Files: AVGVISIB_75S_120M_201608 and AVGVISIB_75S_120M_201608_EARTH.
- Gläser, P. et al. 2018, Planetary and Space Science 162, 170-178 (published illumination values used for validation): https://ntrs.nasa.gov/citations/20170007365
- Bussey, D. B. J. et al. 2010, Icarus 208, 558-564, https://doi.org/10.1016/j.icarus.2010.03.028 (best-lit point coordinates)
- De Rosa, D. et al. 2012, Planetary and Space Science 74, 224-246, https://arxiv.org/abs/1208.5587 (de Gerlache and Malapert points)

## Sites
- NSSDCA lunar artifact table (Apollo, Chang'e, SLIM, Blue Ghost landing coordinates): https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html
- LROC images 1360 (Odysseus), 1408 (Athena) and 1314 (Chandrayaan-3), NASA/GSFC/Arizona State University: https://lroc.im-ldi.com/images/1360 , https://lroc.im-ldi.com/images/1408 , https://lroc.im-ldi.com/images/1314
- LROC NAC low-Sun mosaics of the candidate regions (region centres), NASA/GSFC/Arizona State University: https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_CABEUSPKLO1 and HAWORTH_LO1, MALAPERTLO1, MOUTNPLTLO1, MTMOUTONLO1, NOBILE02LO1, DEGERRIMLO1
- NASA, update on Artemis III candidate landing regions, Oct 28 2024: https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/
- NASA, preliminary Artemis III mission plans, May 13 2026: https://www.nasa.gov/missions/artemis/artemis-3/nasa-outlines-preliminary-artemis-iii-mission-plans/
- IAU Gazetteer of Planetary Nomenclature, Statio Shiv Shakti: https://planetarynames.wr.usgs.gov/Feature/Statio%20Shiv%20Shakti

## Software in the web app
- React and React DOM 18.3 (MIT): https://react.dev
- Vite 5.4 (MIT): https://vitejs.dev
- TypeScript 5.6 (Apache-2.0): https://www.typescriptlang.org
- Leaflet 1.9.4 (BSD-2-Clause): https://leafletjs.com
- Vitest 2.1 (MIT), tests only: https://vitest.dev

## Software in the data pipeline
- SpiceyPy and CSPICE (NAIF), NumPy, SciPy, Numba, Rasterio (GDAL), pyproj, Pillow, Requests

## Design
- NASA Horizon Design System, HDS Core (CC0, public domain): https://github.com/nasa/hds-core . Used for color roles, type roles, spacing, and 7 icons inlined unchanged in web/src/ui/Icon.tsx. The NASA insignia, logotype and identifiers are not covered by that release and are not used. This project is not affiliated with or endorsed by NASA.
- Inter (Rasmus Andersson) and DM Mono (Colophon Foundry), SIL Open Font License 1.1, woff2 files taken from HDS Core and self-hosted in web/src/fonts.
- Public Sans (USWDS / GSA, a fork of Libre Franklin), SIL Open Font License 1.1 with GSA changes in the public domain: https://github.com/uswds/public-sans , self-hosted in web/src/fonts.
- License texts for the three fonts and HDS Core ship in web/public/licenses.

## Demo video
- Recorded from the app with headless Google Chrome (DevTools screencast) and cut with FFmpeg (https://ffmpeg.org). No stock footage, music or voice.

## AI assistance
- Claude by Anthropic helped write the code, the text and the demo video scripts, under the direction of the team. Every number in the app comes from the NASA data and checks above.
