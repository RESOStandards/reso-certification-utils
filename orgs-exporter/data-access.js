const https = require('https');

const { sleep } = require('./utils');

const REQUEST_TIMEOUT_MS = (process.env.REQUEST_TIMEOUT_S || 30) * 1000;
const { API_KEY, SERVER_URL, ENDORSEMENTS_PATH, UOI_GOOGLE_SHEET_URL } = process.env;

const DATA_DICTIONARY_DISPLAY_NAME = 'Data Dictionary',
  DATA_DICTIONARY_IDX_PAYLOAD_DISPLAY_NAME = 'Data Dictionary with IDX Payload',
  WEB_API_CORE_DISPLAY_NAME = 'Web API Core',
  LEGACY_WEB_API_DISPLAY_NAME = 'Web API',
  LEGACY_SEARCH_STRING = 'legacy',
  MLS_ORGANIZATION_TYPE = 'MLS',
  ORGANIZATION_COLUMN = 'OrganizationStatus',
  ACTIVE_STATUS_FLAG = '1',
  CURRENT_DATA_DICTIONARY_VERSIONS = ['1.7'],
  CURRENT_WEB_API_CORE_VERSIONS = ['2.0.0'],
  MAPPED_ENDORSEMENTS_FIELD_NAME = 'Endorsements',
  CERTIFIED_STATUS = 'Certified',
  CERTIFIED_CURRENT_DISPLAY_NAME = 'Certified Current',
  PASSED_CURRENT_DISPLAY_NAME = 'Passed Current',
  CERTIFIED_LEGACY_DISPLAY_NAME = 'Certified Legacy',
  UNCERTIFIED_DISPLAY_NAME = 'Uncertified',
  CERTIFICATION_SUMMARY_BASE_URL = 'https://certification.reso.org/summary';

const CERTIFIABLE_ORG_TYPES = [
  'MLS',
  'Technology Company',
  'Commercial',
  'Brokerage',
  'Pooled Platform'
];

const ENDORSEMENTS = {
  DATA_DICTIONARY: 'data_dictionary',
  DATA_DICTIONARY_IDX_PAYLOAD: 'data_dictionary_with_IDX_payload',
  WEB_API_CORE: 'web_api_server_core'
};

const STATUSES = {
  PASSED: 'passed',
  REVOKED: 'revoked',
  CERTIFIED: 'certified',
  NOTIFIED: 'recipient_notified'
};

const buildEndorsementsFilterOptions = (from = 0) => {
  return {
    options: {
      from,
      endorsementFilter: [],
      statusFilter: [STATUSES.PASSED, STATUSES.REVOKED, STATUSES.CERTIFIED, STATUSES.NOTIFIED],
      showMyResults: false,
      providerUoi: null,
      searchKey: '',
      sortBy: 'asc'
    }
  };
};

const isOrganizationActive = record =>
  record[ORGANIZATION_COLUMN] && record[ORGANIZATION_COLUMN] === ACTIVE_STATUS_FLAG;

const getEndorsementDisplayName = status => {
  if (status === STATUSES.PASSED || status === STATUSES.NOTIFIED) return 'Passed';
  if (status === STATUSES.CERTIFIED) return 'Certified';
  return status;
};

const getEndorsementTypeDisplayName = type => {
  if (type === ENDORSEMENTS.WEB_API_CORE) return WEB_API_CORE_DISPLAY_NAME;
  if (type === ENDORSEMENTS.DATA_DICTIONARY) return DATA_DICTIONARY_DISPLAY_NAME;
  if (type === ENDORSEMENTS.DATA_DICTIONARY_IDX_PAYLOAD)
    return DATA_DICTIONARY_IDX_PAYLOAD_DISPLAY_NAME;
  return `${type}`;
};

const getOrgs = async () => await get(UOI_GOOGLE_SHEET_URL);

const covertGoogleSheetJsonToOrgsJson = ({ values = [] } = {}) => {
  const ORGS_COLUMNS = [
    'OrganizationUniqueId',
    'OrganizationType',
    'OrganizationName',
    'OrganizationAddress1',
    'OrganizationCity',
    'OrganizationStateOrProvince',
    'OrganizationPostalCode',
    'OrganizationWebsite',
    'OrganizationCountry',
    'ModificationTimestamp',
    'OrganizationLatitude',
    'OrganizationLongitude',
    'OrganizationMemberCount',
    'OrganizationCertName',
    'OrganizationDdStatus',
    'OrganizationDdVersion',
    'OrganizationWebApiStatus',
    'OrganizationWebApiVersion'
  ];

  const [keys = [], ...data] = values;

  return data.reduce((results, items = []) => {
    const transformed = items.reduce((acc, item, index) => {
      acc[keys[index]] = item;
      return acc;
    }, {});

    if (isOrganizationActive(transformed)) {
      results.push(
        ORGS_COLUMNS.reduce((acc, columnName) => {
          if (columnName === 'OrganizationLatitude') {
            const lat = parseFloat(transformed[columnName]);
            transformed[columnName] = isNaN(lat) ? null : lat;
          }

          if (columnName === 'OrganizationLongitude') {
            const lng = parseFloat(transformed[columnName]);
            transformed[columnName] = isNaN(lng) ? null : lng;
          }

          if (columnName === 'OrganizationMemberCount') {
            const count = parseInt(transformed[columnName]?.replace(',', ''), 10) || null;
            transformed[columnName] = count;
          }

          acc[columnName] = transformed[columnName] || null;
          return acc;
        }, {})
      );
    }
    return results;
  }, []);
};

const fetchOrgs = async () => covertGoogleSheetJsonToOrgsJson(await getOrgs());

const fetchEndorsements = async () => {
  let lastIndex = 0,
    lastStatusCode = 0;
  const results = {};

  do {
    const { statusCode, data } = await post(
      SERVER_URL + ENDORSEMENTS_PATH,
      buildEndorsementsFilterOptions(lastIndex)
    );

    const { lastUoiIndex, reportsByOrgs = {} } = data;

    //if there's no data in the response, we've reached the end: terminate
    if (!Object.keys(reportsByOrgs).length) break;

    lastIndex = lastUoiIndex;
    lastStatusCode = statusCode;

    Object.entries(reportsByOrgs).map(([uoi, endorsements = []]) => {
      if (!results[uoi]) results[uoi] = [];
      results[uoi].push(
        ...endorsements.map(({ type, version, status, providerUoi, statusUpdatedAt }) => {
          return {
            Endorsement: getEndorsementTypeDisplayName(type),
            Version: version,
            Status: getEndorsementDisplayName(status),
            ProviderUoi: providerUoi,
            StatusUpdatedAt: statusUpdatedAt
          };
        })
      );
    });

    //sleep 1s so we don't hammer the server if it's busy
    await sleep(1000);
  } while (lastStatusCode >= 200 && lastStatusCode < 300);

  return results;
};

const fetchOrgsAndEndorsements = async () => {
  const endorsements = await fetchEndorsements();
  const orgs = await fetchOrgs();

  return orgs.map(org => {
    const {
      OrganizationUniqueId,
      OrganizationType,
      OrganizationDdStatus,
      OrganizationDdVersion,
      OrganizationWebApiStatus,
      OrganizationWebApiVersion,
      ...rest
    } = org;

    const orgEndorsements = [];

    if (endorsements[OrganizationUniqueId]?.length) {
      orgEndorsements.push(...endorsements[OrganizationUniqueId]);
    }

    const certificationStatus = computeRecipientEndorsementStatus(
      orgEndorsements,
      OrganizationType,
      OrganizationDdStatus,
      OrganizationWebApiStatus
    );

    const result = {
      OrganizationUniqueId,
      OrganizationType,
      ...rest
    };

    if (CERTIFIABLE_ORG_TYPES.includes(OrganizationType)) {
      result.CertificationStatus = certificationStatus;
      result.CertificationSummaryUrl = `${CERTIFICATION_SUMMARY_BASE_URL}/${OrganizationUniqueId}`;
    } else {
      return result;
    }

    if (orgEndorsements?.length) {
      result[MAPPED_ENDORSEMENTS_FIELD_NAME] = endorsements[OrganizationUniqueId];
    } else if (certificationStatus === CERTIFIED_LEGACY_DISPLAY_NAME) {
      const legacy = [];

      if (OrganizationDdVersion) {
        legacy.push({
          Endorsement: DATA_DICTIONARY_DISPLAY_NAME,
          Version: OrganizationDdVersion,
          Status: CERTIFIED_LEGACY_DISPLAY_NAME
        });
      }

      if (OrganizationWebApiVersion) {
        legacy.push({
          Endorsement: LEGACY_WEB_API_DISPLAY_NAME,
          Version: OrganizationWebApiVersion,
          Status: CERTIFIED_LEGACY_DISPLAY_NAME
        });
      }

      result[MAPPED_ENDORSEMENTS_FIELD_NAME] = legacy;
    }

    return result;
  });
};

const computeRecipientEndorsementStatus = (
  endorsements = [],
  organizationType = '',
  organizationDdStatus = '',
  organizationWebApiStatus = ''
) => {
  const isMlsRecipient =
    organizationType?.toLowerCase() === MLS_ORGANIZATION_TYPE.trim().toLowerCase();

  if (!endorsements?.length) {
    if (
      isMlsRecipient &&
      organizationDdStatus?.toLowerCase().includes(LEGACY_SEARCH_STRING) &&
      organizationWebApiStatus?.toLowerCase().includes(LEGACY_SEARCH_STRING)
    ) {
      return CERTIFIED_LEGACY_DISPLAY_NAME;
    } else if (
      organizationDdStatus?.toLowerCase().includes(LEGACY_SEARCH_STRING) ||
      organizationWebApiStatus?.toLowerCase().includes(LEGACY_SEARCH_STRING)
    ) {
      return CERTIFIED_LEGACY_DISPLAY_NAME;
    } else {
      return UNCERTIFIED_DISPLAY_NAME;
    }
  }

  const isCertified = Object.values(
    endorsements.reduce((acc, { ProviderUoi, Endorsement, Status, Version }) => {
      if (!acc[ProviderUoi])
        acc[ProviderUoi] = {
          hasWebApi: false,
          hasDD: false
        };

      if (!acc[ProviderUoi].hasWebApi) {
        acc[ProviderUoi].hasWebApi =
          Endorsement === WEB_API_CORE_DISPLAY_NAME &&
          CURRENT_WEB_API_CORE_VERSIONS.includes(Version) &&
          Status === CERTIFIED_STATUS;
      }

      if (!acc[ProviderUoi].hasDD) {
        acc[ProviderUoi].hasDD =
          Endorsement === DATA_DICTIONARY_DISPLAY_NAME &&
          CURRENT_DATA_DICTIONARY_VERSIONS.includes(Version) &&
          Status === CERTIFIED_STATUS;
      }

      return acc;
    }, {})
  ).reduce((acc, { hasWebApi, hasDD }) => {
    //{ T00000044: { hasWebApi: true, hasDD: true } }
    if (!acc) {
      acc = isMlsRecipient ? hasWebApi && hasDD : hasWebApi || hasDD;
    }
    return acc;
  }, false);

  return isCertified ? CERTIFIED_CURRENT_DISPLAY_NAME : PASSED_CURRENT_DISPLAY_NAME;
};

const buildTotalsTemplate = () => {
  return {
    [`${CERTIFIED_CURRENT_DISPLAY_NAME}`]: 0,
    [`${PASSED_CURRENT_DISPLAY_NAME}`]: 0,
    [`${CERTIFIED_LEGACY_DISPLAY_NAME}`]: 0,
    [`${UNCERTIFIED_DISPLAY_NAME}`]: 0
  };
};

const computeEndorsementStats = async (orgAndEndorsementsData = []) =>
  orgAndEndorsementsData.reduce((stats, item) => {
    const { CertificationStatus, OrganizationType } = item;

    if (!CertificationStatus) return stats;

    if (!stats?.All) {
      stats.All = buildTotalsTemplate();
    }

    if (!stats[OrganizationType]) {
      stats[OrganizationType] = buildTotalsTemplate();
    }

    if (CertificationStatus === CERTIFIED_CURRENT_DISPLAY_NAME) {
      stats.All[CERTIFIED_CURRENT_DISPLAY_NAME]++;
      stats[OrganizationType][CERTIFIED_CURRENT_DISPLAY_NAME]++;
    }

    if (CertificationStatus === PASSED_CURRENT_DISPLAY_NAME) {
      stats.All[PASSED_CURRENT_DISPLAY_NAME]++;
      stats[OrganizationType][PASSED_CURRENT_DISPLAY_NAME]++;
    }

    if (CertificationStatus === CERTIFIED_LEGACY_DISPLAY_NAME) {
      stats.All[CERTIFIED_LEGACY_DISPLAY_NAME]++;
      stats[OrganizationType][CERTIFIED_LEGACY_DISPLAY_NAME]++;
    }

    if (CertificationStatus === UNCERTIFIED_DISPLAY_NAME) {
      stats.All[UNCERTIFIED_DISPLAY_NAME]++;
      stats[OrganizationType][UNCERTIFIED_DISPLAY_NAME]++;
    }

    return stats;
  }, {});

const post = async (url, body = {}) => {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `ApiKey ${API_KEY}`
    },
    maxRedirects: 5,
    timeout: REQUEST_TIMEOUT_MS
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, res => {
      let rawData = '';

      res.on('data', chunk => {
        rawData += chunk;
      });

      res.on('end', () => {
        try {
          resolve({ statusCode: res?.statusCode, data: JSON.parse(rawData) });
        } catch (err) {
          reject(new Error(err));
        }
      });
    });

    req.on('error', err => {
      reject(new Error(err));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
};

const get = async url => {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let rawData = '';

      res.on('data', chunk => {
        rawData += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (err) {
          reject(new Error(err));
        }
      });
    });

    req.on('error', err => {
      reject(new Error(err));
    });
  });
};

module.exports = {
  fetchOrgsAndEndorsements,
  computeEndorsementStats
};
