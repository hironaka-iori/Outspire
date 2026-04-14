# Map

## Overview

The Map feature displays the WFLA campus on an Apple MapKit map with a boundary polygon and coordinate conversion for users in mainland China.

## Components

### MapView

`Features/Map/View/MapView.swift`

- Displays campus location marker at WFLA coordinates
- Draws a 9-point boundary polygon around the campus
- Pre-computes converted coordinates based on `RegionChecker.isChinaRegion`
- Includes compass and scale view controls
- Region recheck triggered on position change >1000m

### RegionChecker

`Features/Map/Utils/RegionCheck.swift`

Detects whether the device is in mainland China by:

1. **Primary method**: Reverse geocode Taipei coordinates via MapKit; if country code is "CN", device uses Chinese map service
2. **Fallback**: Fetch Apple's region code from HTTP endpoint

This detection is needed because Chinese map regulations require GCJ-02 coordinate system instead of WGS-84.

### ChinaCoordinateConvertion

`Features/Map/Utils/ChinaCoordinateConvertion.swift`

Implements the GCJ-02 coordinate obfuscation system mandated by Chinese law:

- **Forward** (`coordinateHandler`): WGS-84 → GCJ-02 (adds obfuscation offset)
- **Reverse** (`reverseCoordinateHandler`): GCJ-02 → WGS-84 (10-iteration refinement)
- **Bounds check**: Only converts coordinates within China (lon 72-135, lat 3.86-53.55)
- Algorithm uses complex sine/cosine transform functions

## Why This Exists

Apple Maps uses GCJ-02 coordinates in China but WGS-84 elsewhere. Without conversion, the campus marker would appear in the wrong location for users accessing the app from within China. The RegionChecker determines which coordinate system to use, and ChinaCoordinateConvertion handles the math.
