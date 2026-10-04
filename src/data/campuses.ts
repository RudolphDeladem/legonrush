// Campuses riders can pick. Legon is the only one built so far; the rest show as coming soon.

export interface Campus {
  id: string;
  name: string;
  short: string;
  city: string;
  open: boolean;
}

export const CAMPUSES: Campus[] = [
  { id: 'ug', name: 'University of Ghana', short: 'Legon', city: 'Accra', open: true },
  { id: 'upsa', name: 'University of Professional Studies', short: 'UPSA', city: 'Accra', open: false },
  { id: 'knust', name: 'Kwame Nkrumah University of Science and Technology', short: 'KNUST', city: 'Kumasi', open: false },
  { id: 'ucc', name: 'University of Cape Coast', short: 'UCC', city: 'Cape Coast', open: false },
  { id: 'ashesi', name: 'Ashesi University', short: 'Ashesi', city: 'Berekuso', open: false },
  { id: 'gimpa', name: 'GIMPA', short: 'GIMPA', city: 'Accra', open: false },
  { id: 'uew', name: 'University of Education, Winneba', short: 'UEW', city: 'Winneba', open: false },
  { id: 'uds', name: 'University for Development Studies', short: 'UDS', city: 'Tamale', open: false },
  { id: 'umat', name: 'University of Mines and Technology', short: 'UMaT', city: 'Tarkwa', open: false },
];

export const campusById = (id: string) => CAMPUSES.find((c) => c.id === id && c.open) ?? CAMPUSES[0];
