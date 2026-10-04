// Real positions on the University of Ghana, Legon campus.
// Building coordinates come from the UG Campus Map by enkayyy97
// (https://enkayyy97.github.io/ug-campus-map/). That map has no road data, so the
// route below runs between real building positions; the roads themselves are an
// approximation until they are traced from OpenStreetMap.

export type PlaceKind = 'hall' | 'academic' | 'landmark' | 'service';

export interface Place {
  name: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  /** building footprint along the road, height, depth away from the road (metres) */
  size: [number, number, number];
}

export const PLACES: Place[] = [
  { name: 'Valco Trust Hostel', kind: 'hall', lat: 5.6443, lng: -0.1869, size: [50, 18, 24] },
  { name: 'Vikings Hostel', kind: 'hall', lat: 5.6442, lng: -0.1856, size: [40, 15, 22] },
  { name: 'Mensah Sarbah Hall', kind: 'hall', lat: 5.6462, lng: -0.1871, size: [80, 14, 40] },
  { name: 'Central Cafeteria', kind: 'service', lat: 5.6468, lng: -0.1868, size: [36, 7, 24] },
  { name: 'Legon Hall Annex', kind: 'hall', lat: 5.6474, lng: -0.1881, size: [50, 16, 24] },
  { name: 'Legon Hall', kind: 'hall', lat: 5.6502, lng: -0.1884, size: [80, 14, 40] },
  { name: 'Department of History', kind: 'academic', lat: 5.6501, lng: -0.1894, size: [30, 10, 18] },
  { name: 'Sociology Department', kind: 'academic', lat: 5.6503, lng: -0.1897, size: [30, 10, 18] },
  { name: 'Commonwealth Hall', kind: 'hall', lat: 5.6506, lng: -0.1925, size: [70, 16, 34] },
  { name: 'Great Hall', kind: 'landmark', lat: 5.6507, lng: -0.196, size: [44, 22, 30] },
  { name: 'Research and Innovation Office', kind: 'academic', lat: 5.6537, lng: -0.1928, size: [40, 12, 22] },
  { name: 'School of Graduate Studies', kind: 'academic', lat: 5.6531, lng: -0.1907, size: [34, 12, 20] },
  { name: 'School of Nursing and Midwifery', kind: 'academic', lat: 5.6538, lng: -0.1902, size: [40, 12, 22] },
  { name: 'School of Pharmacy', kind: 'academic', lat: 5.6538, lng: -0.1893, size: [40, 12, 22] },
  { name: 'Volta Hall', kind: 'hall', lat: 5.6518, lng: -0.1898, size: [60, 13, 32] },
  { name: 'French Department', kind: 'academic', lat: 5.6509, lng: -0.1887, size: [26, 9, 16] },
  { name: 'Department of Economics', kind: 'academic', lat: 5.651, lng: -0.1874, size: [34, 12, 20] },
  { name: 'Ghana Korea Information Access Centre', kind: 'academic', lat: 5.652, lng: -0.1877, size: [26, 9, 16] },
  { name: 'Balme Library', kind: 'landmark', lat: 5.6518, lng: -0.1871, size: [46, 20, 30] },
  { name: 'Department of Physics', kind: 'academic', lat: 5.6512, lng: -0.1856, size: [34, 12, 20] },
  { name: 'Department of Chemistry', kind: 'academic', lat: 5.6528, lng: -0.1853, size: [34, 12, 20] },
  { name: 'Akuafo Hall', kind: 'hall', lat: 5.6503, lng: -0.1857, size: [80, 12, 40] },
  { name: 'Centre for International Affairs', kind: 'academic', lat: 5.6521, lng: -0.1841, size: [30, 10, 18] },
  { name: 'Department of Mathematics', kind: 'academic', lat: 5.6538, lng: -0.1841, size: [30, 12, 18] },
  { name: 'JQB Lecture Hall', kind: 'academic', lat: 5.6523, lng: -0.1819, size: [60, 18, 26] },
  { name: 'Institute of African Studies', kind: 'academic', lat: 5.6511, lng: -0.1819, size: [34, 12, 20] },
  { name: 'College of Humanities', kind: 'academic', lat: 5.6537, lng: -0.1822, size: [44, 14, 24] },
  { name: 'School of Law', kind: 'academic', lat: 5.654, lng: -0.1832, size: [40, 14, 22] },
  { name: 'School of Engineering Sciences', kind: 'academic', lat: 5.6553, lng: -0.183, size: [56, 16, 28] },
];

/** Every other building on the source map: drawn as unlabelled blocks so the campus fills out. */
export const OTHER_BUILDINGS: [number, number][] = [
  [5.6545, -0.1838], [5.6587, -0.1777], [5.651, -0.1832], [5.6527, -0.1845], [5.6547, -0.1864], [5.6551, -0.1866],
  [5.6552, -0.1871], [5.6534, -0.1875], [5.6537, -0.1884], [5.6528, -0.1812], [5.6526, -0.181], [5.6536, -0.1819],
  [5.6515, -0.1811], [5.6518, -0.1813], [5.6508, -0.1811], [5.6512, -0.1845], [5.6539, -0.1862], [5.6547, -0.1894],
  [5.6545, -0.1844], [5.6499, -0.1832], [5.6497, -0.1834], [5.6502, -0.1838], [5.6488, -0.1837], [5.6491, -0.1837],
  [5.6501, -0.1848], [5.6492, -0.1808], [5.6513, -0.1828], [5.6556, -0.1831], [5.656, -0.1879], [5.6566, -0.1879],
  [5.655, -0.1883], [5.6494, -0.1877], [5.6479, -0.1912], [5.6493, -0.1877], [5.6503, -0.1848], [5.6503, -0.1841],
  [5.6497, -0.1839], [5.6546, -0.187], [5.6551, -0.1873], [5.6549, -0.1876], [5.6509, -0.1883], [5.6509, -0.1881],
  [5.6512, -0.188], [5.6366, -0.1827], [5.6538, -0.1838], [5.6348, -0.1847], [5.6501, -0.1819], [5.6476, -0.1856],
  [5.6454, -0.1854], [5.6567, -0.1814], [5.6572, -0.182], [5.6585, -0.1819], [5.6584, -0.1813], [5.6629, -0.1817],
  [5.663, -0.1797], [5.6662, -0.1821], [5.6405, -0.186], [5.6399, -0.1852], [5.6373, -0.1848], [5.637, -0.1855],
  [5.6358, -0.1877], [5.6355, -0.1882], [5.6511, -0.1779], [5.6393, -0.1811], [5.6427, -0.1856], [5.6527, -0.1839],
];

/** Campus Loop: Valco Trust south of Sarbah, past the halls to the Great Hall, then east past Balme to Engineering. */
export const CAMPUS_LOOP_PATH: [number, number][] = [
  [5.6432, -0.1862],
  [5.6450, -0.1864],
  [5.6466, -0.1876],
  [5.6488, -0.1880],
  [5.6497, -0.1890],
  [5.6501, -0.1912],
  [5.6501, -0.1935],
  [5.6500, -0.1952],
  [5.6512, -0.1952],
  [5.6527, -0.1936],
  [5.6533, -0.1915],
  [5.6532, -0.1898],
  [5.6523, -0.1888],
  [5.6514, -0.1880],
  [5.6515, -0.1862],
  [5.6518, -0.1846],
  [5.6517, -0.1828],
  [5.6530, -0.1827],
  [5.6546, -0.1836],
];

// Local metric frame centred on Balme Library: +x east, -z north (the game rides toward -z).
const LAT0 = 5.6518;
const LNG0 = -0.1871;
const M_LAT = 110574;
const M_LNG = 111320 * Math.cos((LAT0 * Math.PI) / 180);
export const toLocal = (lat: number, lng: number): [number, number] => [(lng - LNG0) * M_LNG, -(lat - LAT0) * M_LAT];
