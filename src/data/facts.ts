// Short facts for the main University of Ghana, Legon landmarks, for the Fresher tour.
// Kept modest and checkable: no made-up dates or numbers. `place` is the name on the
// campus map (game/campusmap.ts), so riding there unlocks the fact.

export interface Fact {
  id: string;
  place: string;
  title: string;
  text: string;
}

export const FACTS: Fact[] = [
  { id: 'balme', place: 'The Balme Library', title: 'Balme Library', text: "The university's main library. It is named after David Balme, the first Principal of the University College of the Gold Coast, as the university was first called." },
  { id: 'great-hall', place: 'Great Hall', title: 'Great Hall', text: 'Where congregations (graduation ceremonies) and the biggest university events are held. It stands on Legon Hill.' },
  { id: 'commonwealth', place: 'Commonwealth Hall', title: 'Commonwealth Hall', text: 'An all-male hall on Legon Hill. Its residents are known as Vandals, and the hall motto is "Truth Stands".' },
  { id: 'legon-hall', place: 'Legon Hall', title: 'Legon Hall', text: 'The first hall of residence built on the Legon campus, close to the Balme Library.' },
  { id: 'akuafo', place: 'Akuafo Hall Main', title: 'Akuafo Hall', text: 'One of the five traditional halls. Akuafo is the Akan word for farmers.' },
  { id: 'volta', place: 'Volta Hall', title: 'Volta Hall', text: 'An all-female hall and one of the five traditional halls on campus.' },
  { id: 'sarbah', place: 'Mensah Sarbah Hall', title: 'Mensah Sarbah Hall', text: 'Named after John Mensah Sarbah, a Gold Coast lawyer and nationalist. Its residents call themselves Vikings.' },
  { id: 'night-market', place: 'Night Market', title: 'Night Market', text: 'The go-to place for food on campus, with rows of stalls that stay busy into the evening.' },
  { id: 'sports', place: 'Sports Complex', title: 'Sports Complex', text: "The university's main sports grounds, home to inter-hall games and student sport." },
  { id: 'jqb', place: 'Jones Quartey Building, JQB', title: 'Jones Quartey Building (JQB)', text: 'A busy lecture block used by many departments. Most students call it JQB.' },
  { id: 'hospital', place: 'University of Ghana Hospital', title: 'University Hospital', text: 'The university hospital for students and staff. Most people call it Legon Hospital.' },
  { id: 'main-gate', place: 'Legon Main Entrance', title: 'Main Gate', text: 'The main road entrance to the campus. Trotros and taxis stop close by.' },
  { id: 'registry', place: 'University of Ghana Registry', title: 'Registry', text: 'The main administration building: admissions, records and student matters are handled here.' },
  { id: 'cc', place: 'Central Cafeteria, CC', title: 'Central Cafeteria (CC)', text: 'A central place to eat between lectures. Students just call it CC.' },
  { id: 'ugbs', place: 'University of Ghana Business School', title: 'Business School (UGBS)', text: 'Home of accounting, finance, marketing and management programmes.' },
  { id: 'law', place: 'School of Law', title: 'School of Law', text: "Home of the university's law programmes." },
  { id: 'limann', place: 'Dr. Hilla Limann Hall', title: 'Hilla Limann Hall', text: "One of the four newer Diaspora halls, named after Dr. Hilla Limann, President of Ghana's Third Republic." },
  { id: 'kwapong', place: 'Alexander Kwapong Hall', title: 'Alexander Kwapong Hall', text: 'One of the four Diaspora halls, named after Alexander Kwapong, the first Ghanaian Vice-Chancellor of the university.' },
  { id: 'noguchi', place: 'Noguchi Memorial Institute for Medical Research', title: 'Noguchi Institute', text: 'A medical research institute on campus, named after Hideyo Noguchi, the Japanese scientist who died in Accra while studying yellow fever.' },
];

export const factFor = (place: string) => FACTS.find((f) => f.place === place);
