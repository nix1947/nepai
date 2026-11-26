export type NepseSector =
  | 'Commercial Banks'
  | 'Development Banks'
  | 'Finance'
  | 'Microfinance'
  | 'Hydropower'
  | 'Life Insurance'
  | 'Non-Life Insurance'
  | 'Hotels & Tourism'
  | 'Manufacturing & Processing'
  | 'Investment'
  | 'Trading & Others';

const SYMBOL_SECTOR_MAP: Record<string, NepseSector> = {
  // Commercial Banks
  ADBL: 'Commercial Banks',
  CZBIL: 'Commercial Banks',
  EBL: 'Commercial Banks',
  GBIME: 'Commercial Banks',
  HBL: 'Commercial Banks',
  KBL: 'Commercial Banks',
  LSL: 'Commercial Banks',
  MBL: 'Commercial Banks',
  NABIL: 'Commercial Banks',
  NBL: 'Commercial Banks',
  NICA: 'Commercial Banks',
  NIMB: 'Commercial Banks',
  NMB: 'Commercial Banks',
  PCBL: 'Commercial Banks',
  PRVU: 'Commercial Banks',
  SANIMA: 'Commercial Banks',
  SBI: 'Commercial Banks',
  SBL: 'Commercial Banks',
  SCB: 'Commercial Banks',

  // Development Banks
  CORBL: 'Development Banks',
  EDBL: 'Development Banks',
  GBBL: 'Development Banks',
  GRDBL: 'Development Banks',
  JBBL: 'Development Banks',
  KSBBL: 'Development Banks',
  LBBL: 'Development Banks',
  MDB: 'Development Banks',
  MLBL: 'Development Banks',
  MNBBL: 'Development Banks',
  NABBC: 'Development Banks',
  SADBL: 'Development Banks',
  SAPDBL: 'Development Banks',
  SHINE: 'Development Banks',
  SINDU: 'Development Banks',

  // Finance
  BFC: 'Finance',
  CFCL: 'Finance',
  GFCL: 'Finance',
  GMFIL: 'Finance',
  GUFL: 'Finance',
  ICFC: 'Finance',
  JFL: 'Finance',
  MFIL: 'Finance',
  MPFL: 'Finance',
  NFS: 'Finance',
  PFL: 'Finance',
  PROFL: 'Finance',
  RLFL: 'Finance',
  SFCL: 'Finance',
  SIFC: 'Finance',

  // Life Insurance
  ALICL: 'Life Insurance',
  CLI: 'Life Insurance',
  CREST: 'Life Insurance',
  GMLI: 'Life Insurance',
  HLI: 'Life Insurance',
  ILI: 'Life Insurance',
  LICN: 'Life Insurance',
  NLIC: 'Life Insurance',
  NLICL: 'Life Insurance',
  PMLI: 'Life Insurance',
  RNLI: 'Life Insurance',
  SJLIC: 'Life Insurance',
  SNLI: 'Life Insurance',
  SRLI: 'Life Insurance',

  // Non-Life Insurance
  HEI: 'Non-Life Insurance',
  IGI: 'Non-Life Insurance',
  NICL: 'Non-Life Insurance',
  NIL: 'Non-Life Insurance',
  NLG: 'Non-Life Insurance',
  NMIC: 'Non-Life Insurance',
  PRIN: 'Non-Life Insurance',
  RBCL: 'Non-Life Insurance',
  SALICO: 'Non-Life Insurance',
  SGIC: 'Non-Life Insurance',
  SICL: 'Non-Life Insurance',
  SPIL: 'Non-Life Insurance',
  UAIL: 'Non-Life Insurance',

  // Hotels & Tourism
  CGH: 'Hotels & Tourism',
  CITY: 'Hotels & Tourism',
  KDL: 'Hotels & Tourism',
  OHL: 'Hotels & Tourism',
  SHL: 'Hotels & Tourism',
  TRH: 'Hotels & Tourism',

  // Manufacturing & Processing
  BNL: 'Manufacturing & Processing',
  BNT: 'Manufacturing & Processing',
  GCIL: 'Manufacturing & Processing',
  HDL: 'Manufacturing & Processing',
  SARBTM: 'Manufacturing & Processing',
  SHIVM: 'Manufacturing & Processing',
  SONA: 'Manufacturing & Processing',
  UNL: 'Manufacturing & Processing',

  // Investment
  CHDC: 'Investment',
  CIT: 'Investment',
  ENL: 'Investment',
  HATHY: 'Investment',
  HIDCL: 'Investment',
  NIFRA: 'Investment',
  NRN: 'Investment',

  // Trading & Others
  BBC: 'Trading & Others',
  MKCL: 'Trading & Others',
  NRIC: 'Trading & Others',
  NRM: 'Trading & Others',
  NTC: 'Trading & Others',
  NWCL: 'Trading & Others',
  STC: 'Trading & Others',
  HRL: 'Non-Life Insurance',
};

export function getNepseSector(symbol: string, name?: string | null): NepseSector {
  const cleanSym = (symbol || '').trim().toUpperCase().replace(/P$/, '');
  if (SYMBOL_SECTOR_MAP[cleanSym]) {
    return SYMBOL_SECTOR_MAP[cleanSym];
  }

  const n = (name || '').toLowerCase();
  if (!n) return 'Trading & Others';

  if (n.includes('laghubitta') || n.includes('microfinance')) return 'Microfinance';
  if (n.includes('life insurance') || n.includes('micro life')) return 'Life Insurance';
  if (n.includes('insurance') || n.includes('reinsurance')) return 'Non-Life Insurance';
  if (
    n.includes('hydro') ||
    n.includes('hydropower') ||
    n.includes('urja') ||
    n.includes('power') ||
    n.includes('energy') ||
    n.includes('jalvidhyut') ||
    n.includes('jalavidhyut') ||
    n.includes('vidhyut') ||
    n.includes('khola')
  ) {
    return 'Hydropower';
  }
  if (n.includes('development bank') || n.includes('bikas bank')) return 'Development Banks';
  if (n.includes('finance')) return 'Finance';
  if (n.includes('bank')) return 'Commercial Banks';
  if (n.includes('hotel') || n.includes('resort') || n.includes('cable car') || n.includes('tourism')) {
    return 'Hotels & Tourism';
  }
  if (
    n.includes('cement') ||
    n.includes('distillery') ||
    n.includes('bottlers') ||
    n.includes('unilever') ||
    n.includes('spin') ||
    n.includes('iron') ||
    n.includes('steel') ||
    n.includes('industries') ||
    n.includes('manufacturing')
  ) {
    return 'Manufacturing & Processing';
  }
  if (n.includes('investment') || n.includes('infrastructure')) return 'Investment';

  return 'Trading & Others';
}
