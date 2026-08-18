/* =========================================================================
   data.js — Skill taxonomy, synonym maps, and demo seed data
   ========================================================================= */

/* ---- Automation context taxonomy (Section 7: avoid false matches) ---- */
const AUTOMATION_CONTEXTS = {
  industrial: {
    label: "Industrial / Manufacturing Automation",
    keywords: [
      "industrial automation", "manufacturing automation", "plant automation",
      "factory automation", "process automation", "production automation",
      "industrial controls", "automated production line", "assembly line automation"
    ]
  },
  robotics: {
    label: "Robotics",
    keywords: [
      "robotic automation", "robotics", "robotic arm", "robotic cell",
      "industrial robot", "fanuc", "kuka", "abb robot", "yaskawa", "cobot", "collaborative robot"
    ]
  },
  plc: {
    label: "PLC / Controls Automation",
    keywords: [
      "plc automation", "plc programming", "programmable logic controller",
      "siemens plc", "allen-bradley", "allen bradley", "rockwell automation", "scada", "hmi programming"
    ]
  },
  motionControl: {
    label: "Motion Control",
    keywords: ["motion control", "servo systems", "servo drive", "motion controller", "cnc programming"]
  },
  building: {
    label: "Building Automation",
    keywords: ["building automation", "bms", "building management system", "hvac automation", "bacnet"]
  },
  home: {
    label: "Home Automation",
    keywords: ["home automation", "smart home", "home assistant", "consumer automation", "residential automation"]
  },
  it: {
    label: "IT / Infrastructure Automation",
    keywords: ["it automation", "infrastructure automation", "devops automation", "ci/cd automation",
      "cloud automation", "ansible", "terraform automation", "script automation"]
  },
  marketing: {
    label: "Marketing Automation",
    keywords: ["marketing automation", "hubspot automation", "email automation", "campaign automation", "marketo"]
  },
  test: {
    label: "Test / QA Automation",
    keywords: ["test automation", "qa automation", "selenium", "automated testing", "test scripts automation"]
  },
  rpa: {
    label: "Robotic Process Automation (RPA)",
    keywords: ["rpa", "robotic process automation", "uipath", "automation anywhere", "blue prism"]
  },
  av: {
    label: "AV Automation",
    keywords: ["av automation", "audio visual automation", "crestron", "control4", "av integration"]
  }
};

/* ---- Skill synonym map for fuzzy matching ---- */
const SKILL_SYNONYMS = {
  "plc": ["plc", "programmable logic controller", "programmable logic controllers"],
  "siemens": ["siemens", "siemens plc", "s7", "tia portal", "simatic"],
  "allen-bradley": ["allen-bradley", "allen bradley", "rockwell automation", "rslogix", "studio 5000"],
  "robotics": ["robotics", "industrial robot", "robotic arm", "robotic cell", "cobot"],
  "fanuc": ["fanuc", "fanuc robotics"],
  "abb robotics": ["abb robot", "abb robotics"],
  "kuka": ["kuka", "kuka robotics"],
  "motion control": ["motion control", "servo systems", "servo drive", "motion controller"],
  "scada": ["scada", "supervisory control and data acquisition"],
  "hmi": ["hmi", "human machine interface"],
  "vfd": ["vfd", "variable frequency drive"],
  "cnc": ["cnc", "cnc programming", "computer numerical control"],
  "python": ["python"],
  "sql": ["sql", "mysql", "postgresql", "t-sql"],
  "autocad": ["autocad", "auto cad"],
  "solidworks": ["solidworks", "solid works"],
  "six sigma": ["six sigma", "lean six sigma"],
  "iso 9001": ["iso 9001", "iso9001"],
  "electrical schematics": ["electrical schematics", "schematic design", "electrical drawings"],
  "instrumentation": ["instrumentation", "process instrumentation"],
  "hydraulics": ["hydraulics", "hydraulic systems"],
  "pneumatics": ["pneumatics", "pneumatic systems"]
};

/* ---- Education keyword bank ---- */
const EDUCATION_KEYWORDS = [
  "bachelor", "b.s.", "bs ", "b.eng", "beng", "bachelor's", "b.tech", "btech",
  "master", "m.s.", "ms ", "mba", "master's", "m.eng", "meng", "m.tech", "mtech",
  "associate degree", "diploma", "phd", "ph.d"
];

const CERTIFICATION_KEYWORDS = [
  "certified", "certification", "pmp", "six sigma", "cscp", "csm", "pe license",
  "professional engineer", "cwi", "cqe", "asq", "ce marking", "osha"
];

/* ---- Recommendation bands ---- */
function ratingBand(score) {
  if (score >= 9.0) return { label: "Excellent Match", cls: "band-excellent" };
  if (score >= 8.0) return { label: "Strong Match", cls: "band-strong" };
  if (score >= 7.0) return { label: "Good Match", cls: "band-good" };
  if (score >= 6.0) return { label: "Possible Match", cls: "band-possible" };
  if (score >= 5.0) return { label: "Weak Match", cls: "band-weak" };
  return { label: "Poor Match", cls: "band-poor" };
}

function recommendationFor(score, hardFailBlocking) {
  if (hardFailBlocking) return "Do Not Recommend";
  if (score >= 8.0) return "Strongly Recommend";
  if (score >= 7.0) return "Recommend";
  if (score >= 6.0) return "Consider";
  return "Do Not Recommend";
}

/* ---- Default scoring weights (Section 5) ---- */
const DEFAULT_WEIGHTS = {
  technicalSkills: 30,
  relevantExperience: 25,
  industryDomain: 15,
  toolsTech: 10,
  responsibilities: 10,
  educationCert: 5,
  locationOther: 5
};

/* ---- Default export columns (Section 15) ---- */
const DEFAULT_EXPORT_COLUMNS = [
  "name", "linkedinUrl", "currentTitle", "currentCompany", "location",
  "totalExperience", "relevantExperience", "requiredExperience", "overallScore",
  "matchPercent", "recommendation", "requiredSkillsMatch", "missingSkills",
  "industryMatch", "educationMatch", "certificationMatch", "hardRequirementStatus",
  "aiComments", "qaScore", "qaRecommendation", "qaComments", "qaStatus", "reviewDate"
];

const EXPORT_COLUMN_LABELS = {
  name: "Candidate Name", linkedinUrl: "LinkedIn URL", currentTitle: "Current Title",
  currentCompany: "Current Company", location: "Location", totalExperience: "Total Experience",
  relevantExperience: "Relevant Experience", requiredExperience: "Required Experience",
  overallScore: "Overall Rating", matchPercent: "Match %", recommendation: "Recommendation",
  requiredSkillsMatch: "Required Skills Match", missingSkills: "Missing Skills",
  industryMatch: "Industry Match", educationMatch: "Education Match",
  certificationMatch: "Certification Match", hardRequirementStatus: "Hard Requirement Status",
  aiComments: "AI Comments", qaScore: "QA Rating", qaRecommendation: "QA Recommendation",
  qaComments: "QA Comments", qaStatus: "QA Status", reviewDate: "Review Date"
};

/* =========================================================================
   Demo seed data — Industrial Automation Engineer (Robotics) role, matching
   Nexellence's core industry focus (industrial automation / manufacturing).
   ========================================================================= */

const SAMPLE_JD_TEXT = `Job Title: Industrial Automation Engineer - Robotics
Location: Charlotte, NC (On-site, 4 days/week; 1 day remote)
Department: Manufacturing Engineering

About the Role:
We are seeking an experienced Industrial Automation Engineer to design, program, and maintain robotic
work-cells and PLC-controlled production lines across our automotive components manufacturing facility.
The ideal candidate has hands-on production-floor experience with Siemens and Allen-Bradley PLCs,
FANUC or ABB robotics, and servo-based motion control systems in a high-volume manufacturing environment.

Responsibilities:
- Design, program, and commission robotic work-cells (FANUC/ABB) for automotive component assembly
- Develop and troubleshoot PLC logic (Siemens S7 / Allen-Bradley ControlLogix) for production equipment
- Implement and maintain motion control and servo drive systems on high-speed production lines
- Partner with plant engineering to reduce downtime and improve OEE across automated lines
- Support new equipment installation, SAT/FAT testing, and validation in an automotive/industrial environment
- Maintain HMI/SCADA systems and provide root-cause analysis for automation-related downtime
- Ensure compliance with safety standards for automated and robotic equipment (Cat 3/PLd, ISO 13849)

Requirements:
- Minimum 5 years of industrial automation experience (production/manufacturing floor, not IT or home automation)
- Minimum 3 years of hands-on industrial robotics programming experience (FANUC and/or ABB preferred)
- Demonstrated Siemens PLC and/or Allen-Bradley PLC programming experience
- Motion control / servo systems experience required
- Experience in automotive or industrial manufacturing industry strongly preferred
- Bachelor's degree in Electrical Engineering, Mechatronics, or related field (required)
- Six Sigma or related process improvement certification (preferred)
- Must be authorized to work in the United States without sponsorship

Preferred Skills:
- Allen-Bradley RSLogix/Studio 5000
- SCADA/HMI development
- Root cause / OEE improvement experience
- Experience supporting automotive OEM or Tier 1 suppliers
`;

const SAMPLE_JD_STRUCTURED = {
  title: "Industrial Automation Engineer - Robotics",
  location: "Charlotte, NC",
  workMode: "onsite",
  minExperience: 5,
  maxExperience: 12,
  requiredSkills: ["PLC", "Siemens", "Robotics", "Motion Control"],
  preferredSkills: ["Allen-Bradley", "SCADA", "FANUC", "ABB Robotics", "HMI"],
  requiredTools: ["Siemens S7", "TIA Portal", "FANUC Robotics", "Servo Drives"],
  education: ["Bachelor's degree in Electrical Engineering, Mechatronics, or related field"],
  certifications: ["Six Sigma (preferred)"],
  industries: ["Automotive Manufacturing", "Industrial Manufacturing"],
  domain: ["Industrial Automation", "Robotics"],
  locationRequirements: ["US work authorization without sponsorship", "On-site, Charlotte NC"],
  mandatoryRequirements: [
    { id: "req1", text: "Minimum 5 years of industrial automation experience", type: "experience", minYears: 5, contextTag: "industrial", disqualifying: true },
    { id: "req2", text: "Minimum 3 years of hands-on industrial robotics programming", type: "experience", minYears: 3, contextTag: "robotics", disqualifying: false },
    { id: "req3", text: "Siemens and/or Allen-Bradley PLC programming experience", type: "skill", skill: "PLC", disqualifying: true },
    { id: "req4", text: "Motion control / servo systems experience", type: "skill", skill: "Motion Control", disqualifying: false },
    { id: "req5", text: "Bachelor's degree in Electrical Engineering, Mechatronics, or related field", type: "education", disqualifying: false },
    { id: "req6", text: "US work authorization without sponsorship", type: "other", disqualifying: true }
  ],
  preferredRequirements: [
    { id: "pref1", text: "Automotive or Tier 1 supplier manufacturing experience" },
    { id: "pref2", text: "Six Sigma / process improvement certification" },
    { id: "pref3", text: "SCADA/HMI development experience" }
  ]
};

/* ---- Sample candidates: mix of resume + LinkedIn text (pasted, not scraped) ---- */
const SAMPLE_CANDIDATES = [
  {
    name: "Marcus Reyes",
    linkedinUrl: "https://www.linkedin.com/in/marcus-reyes-automation/",
    resumeFileName: "Marcus_Reyes_Resume.pdf",
    linkedinText: `Marcus Reyes - Senior Industrial Automation Engineer at AutoDrive Components
Charlotte, North Carolina Area
Senior Industrial Automation Engineer at AutoDrive Components (2020 - Present)
Automation Engineer at Tier1 Motion Systems (2016 - 2020)
Controls Technician at Continental Automotive (2014 - 2016)
Education: B.S. Electrical Engineering, NC State University
Skills: Siemens PLC, TIA Portal, FANUC Robotics, Motion Control, Servo Drives, SCADA, Root Cause Analysis`,
    resumeText: `MARCUS REYES
Senior Industrial Automation Engineer
Charlotte, NC | marcus.reyes@email.com

EXPERIENCE
Senior Industrial Automation Engineer, AutoDrive Components (Automotive Tier 1) — Jan 2020 - Present
- Programmed and commissioned FANUC robotic work-cells for automotive component assembly lines
- Developed Siemens S7 / TIA Portal PLC logic for high-speed production equipment
- Led servo motion control upgrades reducing cycle time by 12% across 6 production lines
- Maintained SCADA/HMI systems and performed root-cause analysis for automation downtime

Automation Engineer, Tier1 Motion Systems (Automotive Manufacturing) — Mar 2016 - Dec 2019
- Supported industrial automation and robotics integration for automotive component manufacturing
- Programmed Allen-Bradley ControlLogix PLCs for conveyor and assembly automation
- Assisted with SAT/FAT testing for new robotic cell installations

Controls Technician, Continental Automotive — Jun 2014 - Feb 2016
- Maintained PLC-controlled production equipment in an automotive manufacturing plant
- Assisted engineers with industrial robotics troubleshooting (ABB robots)

EDUCATION
B.S. Electrical Engineering, North Carolina State University, 2014

CERTIFICATIONS
Six Sigma Green Belt

Authorized to work in the United States (US Citizen).`
  },
  {
    name: "Priya Natarajan",
    linkedinUrl: "https://www.linkedin.com/in/priya-natarajan-eng/",
    resumeFileName: "Priya_Natarajan_CV.docx",
    linkedinText: `Priya Natarajan - Automation Engineer at Precision Robotics Solutions
Greenville, South Carolina
Automation Engineer at Precision Robotics Solutions (2021 - Present)
Manufacturing Engineer at SteelForm Industries (2018 - 2021)
Process Engineer Intern at SteelForm Industries (2017 - 2018)
Education: B.Tech Mechatronics Engineering
Skills: Robotics, ABB Robotics, Allen-Bradley, PLC Programming, Motion Control`,
    resumeText: `PRIYA NATARAJAN
Automation Engineer
Greenville, SC

EXPERIENCE
Automation Engineer, Precision Robotics Solutions (Industrial Manufacturing - metal forming) — Aug 2021 - Present
- Programmed ABB industrial robots for material handling and welding cells
- Developed Allen-Bradley Studio 5000 PLC logic for stamping line automation
- Implemented motion control upgrades on servo-driven press feeders

Manufacturing Engineer, SteelForm Industries — Jun 2018 - Jul 2021
- Supported industrial automation projects for sheet-metal manufacturing lines
- Troubleshot PLC-based production equipment (Allen-Bradley)

Process Engineer Intern, SteelForm Industries — Jun 2017 - May 2018

EDUCATION
B.Tech, Mechatronics Engineering, Anna University, 2018

Work authorization: Requires H-1B sponsorship in 2 years (currently on OPT/STEM extension).`
  },
  {
    name: "Daniel O'Connell",
    linkedinUrl: "https://www.linkedin.com/in/daniel-oconnell-smarthome/",
    resumeFileName: "Daniel_OConnell_Resume.pdf",
    linkedinText: `Daniel O'Connell - Home Automation Specialist at SmartLiving Solutions
Austin, Texas
Home Automation Specialist at SmartLiving Solutions (2019 - Present)
Field Technician at ADT Smart Home (2016 - 2019)
Education: Associate Degree, Electronics Technology
Skills: Home Automation, Smart Home, Crestron, Control4, Networking`,
    resumeText: `DANIEL O'CONNELL
Home Automation Specialist
Austin, TX

EXPERIENCE
Home Automation Specialist, SmartLiving Solutions — 2019 - Present
- Installed and configured home automation systems (Control4, Crestron) for residential clients
- 5+ years of automation experience across smart home and consumer AV integration
- Programmed smart home lighting, HVAC, and security automation routines

Field Technician, ADT Smart Home — 2016 - 2019
- Installed residential smart home automation and security systems

EDUCATION
Associate Degree, Electronics Technology, Austin Community College

No PLC, robotics, or industrial manufacturing experience listed.`
  },
  {
    name: "Sarah Whitfield",
    linkedinUrl: "https://www.linkedin.com/in/sarah-whitfield-plc/",
    resumeFileName: "Sarah_Whitfield_Resume.pdf",
    linkedinText: `Sarah Whitfield - Controls Engineer at Midwest Packaging Systems
Detroit, Michigan
Controls Engineer at Midwest Packaging Systems (2017 - Present)
Junior Controls Engineer at Midwest Packaging Systems (2015 - 2017)
Education: B.S. Electrical Engineering, University of Michigan
Skills: PLC, Siemens, Allen-Bradley, SCADA, Packaging Automation`,
    resumeText: `SARAH WHITFIELD
Controls Engineer
Detroit, MI

EXPERIENCE
Controls Engineer, Midwest Packaging Systems (Industrial Packaging Manufacturing) — May 2017 - Present
- Programmed Siemens S7 and Allen-Bradley PLCs for packaging line automation
- Developed SCADA/HMI screens for production monitoring
- Supported industrial automation upgrades across 4 packaging lines
- Limited robotics exposure; primarily conveyor and packaging equipment automation, not robotic work-cells

Junior Controls Engineer, Midwest Packaging Systems — Jun 2015 - Apr 2017
- Entry-level PLC troubleshooting and maintenance support

EDUCATION
B.S. Electrical Engineering, University of Michigan, 2015

Authorized to work in the United States (US Citizen).`
  },
  {
    name: "James Okafor",
    linkedinUrl: "https://www.linkedin.com/in/james-okafor-itautomation/",
    resumeFileName: "",
    linkedinText: `James Okafor - IT Automation Engineer at CloudScale Systems
Raleigh, North Carolina
IT Automation Engineer at CloudScale Systems (2018 - Present)
DevOps Engineer at DataHost Inc (2015 - 2018)
Education: B.S. Computer Science
Skills: IT Automation, Ansible, Terraform, CI/CD Automation, Python, Cloud Infrastructure`,
    resumeText: ""
  },
  {
    name: "Lisa Chen",
    linkedinUrl: "https://www.linkedin.com/in/lisa-chen-robotics-eng/",
    resumeFileName: "Lisa_Chen_Resume.pdf",
    linkedinText: `Lisa Chen - Robotics Engineer at FutureForm Automotive
Nashville, Tennessee
Robotics Engineer at FutureForm Automotive (2022 - Present)
Automation Technician at Nashville Auto Parts (2019 - 2022)
Education: B.S. Mechatronics Engineering, Tennessee Tech
Skills: FANUC, ABB Robotics, Motion Control, Siemens PLC, Six Sigma`,
    resumeText: `LISA CHEN
Robotics Engineer
Nashville, TN

EXPERIENCE
Robotics Engineer, FutureForm Automotive (Automotive Manufacturing) — Jan 2022 - Present
- Programmed FANUC and ABB robotic work-cells for automotive body-in-white assembly
- Developed Siemens PLC logic and motion control routines for robotic welding cells
- Led industrial automation validation (SAT/FAT) for new robotic line installations

Automation Technician, Nashville Auto Parts (Automotive Manufacturing) — Jun 2019 - Dec 2021
- Supported industrial automation and robotics maintenance on production lines
- Assisted with Allen-Bradley PLC troubleshooting

EDUCATION
B.S. Mechatronics Engineering, Tennessee Technological University, 2019

CERTIFICATIONS
Six Sigma Yellow Belt

Authorized to work in the United States (US Citizen).

NOTE: LinkedIn lists current title as "Robotics Engineer" at FutureForm Automotive since 2022;
resume lists the same role starting Jan 2022 - consistent.`
  },
  {
    name: "Robert Kim",
    linkedinUrl: "https://www.linkedin.com/in/robert-kim-automation-mktg/",
    resumeFileName: "Robert_Kim_Resume.pdf",
    linkedinText: `Robert Kim - Marketing Automation Manager at GrowthSuite
San Diego, California
Marketing Automation Manager at GrowthSuite (2019 - Present)
Marketing Coordinator at BrightAds (2016 - 2019)
Education: B.A. Marketing
Skills: Marketing Automation, HubSpot, Marketo, Campaign Automation, Salesforce`,
    resumeText: `ROBERT KIM
Marketing Automation Manager
San Diego, CA

EXPERIENCE
Marketing Automation Manager, GrowthSuite — 2019 - Present
- 6 years of automation experience building HubSpot and Marketo marketing automation workflows
- Managed campaign automation and lead-scoring systems

Marketing Coordinator, BrightAds — 2016 - 2019

EDUCATION
B.A. Marketing, San Diego State University

No industrial, PLC, or robotics experience.`
  },
  {
    name: "Amanda Torres",
    linkedinUrl: "https://www.linkedin.com/in/amanda-torres-automation-eng/",
    resumeFileName: "Amanda_Torres_Resume.pdf",
    linkedinText: `Amanda Torres - Automation Engineer II at Precision Motion Corp
Greenville, South Carolina
Automation Engineer II at Precision Motion Corp (2023 - Present)
Manufacturing Engineer at Precision Motion Corp (2021 - 2023)
Education: B.S. Electrical Engineering, Clemson University
Skills: Siemens PLC, Motion Control, Servo Systems, SCADA`,
    resumeText: `AMANDA TORRES
Automation Engineer II
Greenville, SC

EXPERIENCE
Automation Engineer II, Precision Motion Corp (Industrial Manufacturing) — Mar 2023 - Present
- Programs Siemens PLC logic and servo motion control systems for production equipment
- Industrial automation experience on high-speed production lines
- Limited robotics programming exposure (assisted on 1 robotic cell installation, ~4 months)

Manufacturing Engineer, Precision Motion Corp — Jul 2021 - Feb 2023
- Entry-level manufacturing and automation support role

EDUCATION
B.S. Electrical Engineering, Clemson University, 2021

Authorized to work in the United States (US Citizen).

Note: LinkedIn shows title "Automation Engineer II" since 2023; resume shows same. LinkedIn does not
mention "Manufacturing Engineer" role from 2021-2023 that appears on the resume — missing position on LinkedIn.`
  }
];

module.exports = {
  AUTOMATION_CONTEXTS, SKILL_SYNONYMS, EDUCATION_KEYWORDS, CERTIFICATION_KEYWORDS,
  ratingBand, recommendationFor, DEFAULT_WEIGHTS, DEFAULT_EXPORT_COLUMNS, EXPORT_COLUMN_LABELS,
  SAMPLE_JD_TEXT, SAMPLE_JD_STRUCTURED, SAMPLE_CANDIDATES
};
