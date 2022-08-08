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
  TECHNOLOGY_COMPANY_ORGANIZATION_TYPE = 'Technology Company';

const ORGANIZATION_COLUMN = 'OrganizationStatus',
  ACTIVE_STATUS_FLAG = '1',
  CURRENT_DATA_DICTIONARY_VERSIONS = ['1.7'],
  CURRENT_WEB_API_CORE_VERSIONS = ['2.0.0'],
  MAPPED_ENDORSEMENTS_FIELD_NAME = 'Endorsements',
  CERTIFIED_STATUS = 'Certified',
  CERTIFIED_CURRENT_DISPLAY_NAME = 'Certified Current',
  PASSED_CURRENT_DISPLAY_NAME = 'Passed Current',
  CERTIFIED_LEGACY_DISPLAY_NAME = 'Certified Legacy',
  UNCERTIFIED_DISPLAY_NAME = 'Uncertified';

const buildEndorsementsFilterOptions = (from = 0) => {
  return {
    options: {
      from,
      endorsementFilter: [],
      statusFilter: ['passed', 'revoked', 'certified', 'recipient_notified'],
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
  if (status === 'passed' || status === 'recipient_notified') return 'Passed';
  if (status === 'certified') return 'Certified';
  return status;
};

const getEndorsementTypeDisplayName = type => {
  if (type === 'web_api_server_core') return WEB_API_CORE_DISPLAY_NAME;
  if (type === 'data_dictionary') return DATA_DICTIONARY_DISPLAY_NAME;
  if (type === 'data_dictionary_with_IDX_payload') return DATA_DICTIONARY_IDX_PAYLOAD_DISPLAY_NAME;
  return `${type}`;
};

const getOrgs = async () => await get(UOI_GOOGLE_SHEET_URL);

const covertGoogleSheetJsonToOrgsJson = ({ values = [] } = {}) => {
  const ORGS_COLUMNS = [
    'OrganizationUniqueId',
    'OrganizationType',
    'AssnToMls',
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

  const keys = values[0] || [],
    data = values.slice(1, values.length) || [];

  return data.reduce((results, items = []) => {
    const transformed = items.reduce((acc, item, index) => {
      acc[keys[index]] = item;
      return acc;
    }, {});

    if (isOrganizationActive(transformed)) {
      results.push(
        ORGS_COLUMNS.reduce((acc, columnName) => {
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

    Object.entries(reportsByOrgs).map(([uoi, endorsements]) => {
      if (!results[uoi]) results[uoi] = [];
      results[uoi].push(
        endorsements.map(({ type, version, status, providerUoi, statusUpdatedAt }) => {
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

    //sleep so we don't hammer the server
    await sleep(2000);
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
      CertificationStatus: certificationStatus,
      ...rest
    };

    if (orgEndorsements?.length) {
      result[MAPPED_ENDORSEMENTS_FIELD_NAME] = endorsements[OrganizationUniqueId];
    } else if (certificationStatus === CERTIFIED_LEGACY_DISPLAY_NAME) {
      const legacy = [];

      if (OrganizationDdVersion) {
        legacy.push({
          Endorsement: DATA_DICTIONARY_DISPLAY_NAME,
          Version: OrganizationDdVersion
        });
      }

      if (OrganizationWebApiVersion) {
        legacy.push({
          Endorsement: LEGACY_WEB_API_DISPLAY_NAME,
          Version: OrganizationWebApiVersion
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
      organizationType?.toLowerCase() === MLS_ORGANIZATION_TYPE.trim().toLowerCase(),
    isTechnologyCompanyRecipient =
      organizationType?.toLowerCase() === TECHNOLOGY_COMPANY_ORGANIZATION_TYPE.trim().toLowerCase();

  if (!endorsements?.length) {
    if (
      isMlsRecipient &&
      organizationDdStatus?.toLowerCase().includes(LEGACY_SEARCH_STRING) &&
      organizationWebApiStatus?.toLowerCase().includes(LEGACY_SEARCH_STRING)
    ) {
      return CERTIFIED_LEGACY_DISPLAY_NAME;
    } else if (
      !isTechnologyCompanyRecipient &&
      (organizationDdStatus?.toLowerCase().includes(LEGACY_SEARCH_STRING) ||
        organizationWebApiStatus?.toLowerCase().includes(LEGACY_SEARCH_STRING))
    ) {
      return CERTIFIED_LEGACY_DISPLAY_NAME;
    } else {
      return UNCERTIFIED_DISPLAY_NAME;
    }
  }

  const isCertified = Object.entries(
    endorsements.reduce((acc, { Endorsement, Version, Status, ProviderUoi }) => {
      if (!ProviderUoi) return acc;

      if (!acc[ProviderUoi])
        acc[ProviderUoi] = {
          hasCurrentWebApiVersion: false,
          hasCurrentDataDictionaryVersion: false
        };

      if (Endorsement === WEB_API_CORE_DISPLAY_NAME) {
        acc[ProviderUoi].hasCurrentWebApiVersion =
          Status === CERTIFIED_STATUS &&
          CURRENT_WEB_API_CORE_VERSIONS.find(version => version === Version);
      }

      if (Endorsement === DATA_DICTIONARY_DISPLAY_NAME) {
        acc[ProviderUoi].hasCurrentWebApiVersion =
          Status === CERTIFIED_STATUS &&
          CURRENT_DATA_DICTIONARY_VERSIONS.find(version => version === Version);
      }

      if (
        isMlsRecipient &&
        acc[ProviderUoi].hasCurrentDataDictionaryVersion &&
        acc[ProviderUoi].hasCurrentWebApiVersion
      ) {
        acc[ProviderUoi].isCertified = true;
      } else if (
        acc[ProviderUoi].hasCurrentDataDictionaryVersion ||
        acc[ProviderUoi].hasCurrentWebApiVersion
      ) {
        acc[ProviderUoi].isCertified = true;
      }

      return acc;
    }, {})
  ).reduce((acc, [, result]) => {
    acc = result?.isCertified || acc;
    return acc;
  }, false);

  return isCertified ? CERTIFIED_CURRENT_DISPLAY_NAME : PASSED_CURRENT_DISPLAY_NAME;
};

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
  fetchOrgsAndEndorsements
};
