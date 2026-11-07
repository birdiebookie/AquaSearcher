# AquaSearcher data-source refresh — 2026-11-07

## What changed

- Phase 1 now queries the USGS 3D Hydrography Program (3DHP) Waterbody layer (60) and River/Canal Flowline layer (50) first.
- Legacy NHD / NHDPlus HR requests remain only as an outage fallback. OpenStreetMap remains an independent supplemental water source.
- Phase 2 now checks NOAA NCEI National Ocean Service hydrographic survey coverage (BAG and digital-sounding footprint counts).
- Phase 2 samples the NOAA NCEI multibeam mosaic at up to the eight highest-ranked candidates. The sample is labelled as coarse regional context (about 90 m grid cells), not a site-specific depth sounding.
- The NOAA NCEI Bathymetric Data Viewer and BlueTopo documentation are linked from the Phase 2 panel.

## Preserved

- Existing water-width filter (25 ft minimum), candidate generation, access weighting, historical imagery logic, vehicle detection, and all Phase 2 score weights are unchanged.
- NOAA coverage/depth metadata does not alter vehicle-likelihood scores.
- The current working branch was preserved at `backup/before-water-data-refresh-2026-11-07`.

## Authoritative sources checked

- USGS 3DHP REST service: https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/FeatureServer
  - Layer 60: Waterbody
  - Layer 50: Flowline
  - Service metadata reports a September 4, 2026 refresh.
- USGS 3DHP access page: https://www.usgs.gov/3d-hydrography-program/access-3dhp-data-products
  - USGS states new elevation-derived hydrography and attributes are added quarterly.
  - NHD, WBD, and NHDPlus HR are legacy products; 3DHP is the current program.
- NOAA NCEI NOS survey coverage: https://gis.ngdc.noaa.gov/arcgis/rest/services/web_mercator/nos_hydro_dynamic/MapServer
  - Layer 0: Surveys with BAGs.
  - Layer 1: Surveys with digital sounding data.
- NOAA NCEI multibeam mosaic: https://gis.ngdc.noaa.gov/arcgis/rest/services/multibeam_mosaics/multibeam_mosaic_combined/ImageServer
  - Single-band Float32 raster, 0.000833333-degree cell size.
  - Used only for a coarse depth-context sample where coverage exists.
- NOAA BlueTopo: https://www.nauticalcharts.noaa.gov/data/bluetopo.html
  - BlueTopo provides elevation, uncertainty, and contributor/source metadata as GeoTIFFs and through nowCOAST WMTS.
  - Coverage is limited to navigationally significant waters and is updated as new surveys become available. The app links to NOAA's viewer rather than treating rendered WMTS tiles as numeric depth values.
- NOAA NCEI Bathymetric Data Viewer: https://www.ncei.noaa.gov/maps/bathymetry/

## Important limitation

BlueTopo is not yet queried as a numeric raster by AquaSearcher. NOAA exposes it through WMTS and tiled GeoTIFF products; using rendered map tiles as numeric depths would be unsafe. The app provides the authoritative viewer link, while numeric NOAA samples currently come from the NCEI multibeam mosaic where available. This keeps the scoring honest and avoids changing candidate rankings based on incomplete coastal coverage.
