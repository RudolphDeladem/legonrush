// University of Ghana departments and programmes for the sign-up picker, grouped by college.
// Written from the university's published structure; add or rename entries here.

export interface DeptGroup {
  college: string;
  departments: string[];
}

export const DEPARTMENTS: DeptGroup[] = [
  {
    college: 'Basic and Applied Sciences',
    departments: [
      'Mathematics', 'Physics', 'Chemistry', 'Statistics and Actuarial Science', 'Computer Science', 'Earth Science',
      'Animal Biology and Conservation Science', 'Plant and Environmental Biology', 'Biochemistry, Cell and Molecular Biology',
      'Marine and Fisheries Sciences', 'Nutrition and Food Science',
      'Agricultural Engineering', 'Biomedical Engineering', 'Computer Engineering', 'Food Process Engineering', 'Materials Science and Engineering',
      'Agricultural Economics and Agribusiness', 'Agricultural Extension', 'Animal Science', 'Crop Science', 'Soil Science', 'Family and Consumer Sciences',
      'Veterinary Medicine',
    ],
  },
  {
    college: 'Health Sciences',
    departments: [
      'Medicine and Surgery', 'Dentistry', 'Pharmacy', 'Nursing', 'Midwifery', 'Public Health',
      'Medical Laboratory Sciences', 'Physiotherapy', 'Radiography', 'Dietetics', 'Occupational Therapy', 'Physician Assistantship',
    ],
  },
  {
    college: 'Humanities',
    departments: [
      'English', 'Linguistics', 'Modern Languages', 'Philosophy and Classics', 'Study of Religions', 'African Studies',
      'Theatre Arts', 'Music', 'Dance Studies',
      'Economics', 'Geography and Resource Development', 'History', 'Political Science', 'Psychology', 'Sociology', 'Social Work',
      'Archaeology and Heritage Studies',
      'Law',
      'Accounting', 'Finance', 'Marketing and Entrepreneurship', 'Operations and Management Information Systems',
      'Organisation and Human Resource Management', 'Public Administration and Health Services Management',
      'Communication Studies', 'Information Studies',
    ],
  },
  {
    college: 'Education',
    departments: ['Teacher Education', 'Educational Studies and Leadership', 'Distance Education'],
  },
];

export const OTHER_DEPARTMENT = 'Other / not a student';

export const ALL_DEPARTMENTS = [...DEPARTMENTS.flatMap((g) => g.departments), OTHER_DEPARTMENT];

export const collegeOf = (d: string) => DEPARTMENTS.find((g) => g.departments.includes(d))?.college ?? '';
