# SunSpy

A sun & moon planner for photo and video shoots on iPhone, built as a web app (PWA): no App Store and no developer account needed.
Ideas taken from Sun Seeker, PhotoPills, Sun Surveyor and SunCalc.org.

- **Map** (vector map or satellite) with a pin you drag, tap, or set by address search (Photon / OpenStreetMap) or coordinates.
- **Sun lines on the map**: sunrise (orange), sunset (red), the sun at the selected time (yellow), and the day's sun path with hour marks (orange part = golden hour). The moon's direction and phase are shown too.
- **Time strip**: drag through the day. Colours show night / twilight / blue hour / golden hour / daylight, with the sun and moon altitude curves. ▶ plays the whole day.
- **Quick jumps** to blue hour, golden hour, sunrise, noon, sunset, plus a full list of the day's events with azimuths.
- **Shadows**: the shadow of an object of a chosen height, true to scale on the map. When zoomed in to street level, **every building casts its shadow** (from OpenStreetMap building heights). 3D buildings are lit from where the sun is.
- **Terrain horizon**: for mountains and valleys, it calculates the skyline up to 50 km away from elevation data and gives the *real* time the sun clears the ridge and drops behind it. Combine it with **3D terrain**.
- **AR camera**: point the phone at the sky to see the sun's path for the chosen day over the camera image, with hour marks and the mountain skyline. Drag sideways to fine-tune the compass.
- **Saved spots** (on this device): save, rename, delete, jump to. Each one shows today's sunrise and sunset.
- **Time zones**: times are always shown in the local time **at the pin**, so you can plan a shoot in another country. Your own time is shown next to it when it differs.
- **Share** a link with the place, date and time.
- Russian and English UI; metres or feet.

## Develop

```powershell
npm install
npm run dev      # http://localhost:5173
npm test         # checks sunrise/sunset maths against published times
npm run build    # production build in dist/
npm run preview  # serve dist/ (service worker / offline mode works here)
```

## Put it on your iPhone

The camera, compass and GPS work in Safari only over HTTPS, so the app has to be hosted. Free options:

- **GitHub Pages**: push this folder to a GitHub repo, then Settings → Pages → Source: **GitHub Actions**. The included workflow (`.github/workflows/deploy.yml`) publishes on every push to `main`.
- **Netlify Drop**: run `npm run build`, then drag the `dist` folder onto https://app.netlify.com/drop.

Then on the iPhone: open the URL in **Safari** → Share → **Add to Home Screen**. Allow location "While Using", and allow camera and motion access the first time you open AR.

## Accuracy and limits

- Sun position is accurate to about 1 arc-minute (times within ±1 minute), using the same algorithms as SunCalc. Golden hour = sun from −4° to +6°, blue hour = −6° to −4°, as in PhotoPills.
- Building shadows use OpenStreetMap heights. Where a building has no height tag, a typical height is assumed. Shadows that fall on other roofs are not drawn. Lattice structures (the Eiffel Tower, for example) are treated as solid.
- The terrain horizon uses ~30–150 m elevation data (Mapzen Terrain Tiles on AWS). It does not include trees or buildings.
- AR depends on the phone's compass. Keep it away from metal and magnets. If the path looks shifted sideways, drag left or right to correct it. The "Field of view" slider matches the drawing to the camera's zoom.
- Maps, search and elevation need an internet connection. Sun times and the AR path work offline once the app has been opened.

## Data

Map © OpenStreetMap contributors, tiles by OpenFreeMap / OpenMapTiles · Imagery © Esri, Maxar · Elevation: Mapzen Terrain Tiles (AWS Open Data) · Search: Photon by Komoot, Nominatim.
