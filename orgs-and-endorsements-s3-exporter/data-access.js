const https = require("https");

const REQUEST_TIMEOUT_MS = process.env.REQUEST_TIMEOUT_S * 1000;
const { API_KEY, SERVER_URL, ENDORSEMENTS_PATH, UOI_GOOGLE_SHEET_URL } = process.env;

const DATA_DICTIONARY_DISPLAY_NAME = "Data Dictionary",
  DATA_DICTIONARY_IDX_PAYLOAD_DISPLAY_NAME = "Data Dictionary with IDX Payload",
  WEB_API_CORE_DISPLAY_NAME = "Web API Core";

const CURRENT_DATA_DICTIONARY_VERSIONS = ["1.7"],
  CURRENT_WEB_API_CORE_VERSIONS = ["2.0.0"],
  ORGANIZATION_COLUMN = "OrganizationStatus",
  ACTIVE_STATUS_FLAG = "1",
  MAPPED_ENDORSEMENTS_FIELD_NAME = "Endorsements";

const buildEndorsementsFilterOptions = (from = 0) => {
  return {
    options: {
      from,
      endorsementFilter: [],
      statusFilter: ["passed", "revoked", "certified", "recipient_notified"],
      showMyResults: false,
      providerUoi: null,
      searchKey: "",
      sortBy: "asc",
    },
  };
};

const isOrganizationActive = record => record[ORGANIZATION_COLUMN] && record[ORGANIZATION_COLUMN] === ACTIVE_STATUS_FLAG;

const getEndorsementDisplayName = (status) => {
  if (status === "passed" || status === "recipient_notified") return "Passed";
  if (status === "certified") return "Certified";
  return status;
};

const getEndorsementTypeDisplayName = (type) => {
  if (type === "web_api_server_core") return WEB_API_CORE_DISPLAY_NAME;
  if (type === "data_dictionary") return DATA_DICTIONARY_DISPLAY_NAME;
  if (type === "data_dictionary_with_IDX_payload")
    return DATA_DICTIONARY_IDX_PAYLOAD_DISPLAY_NAME;
  return `${type}`;
};

const getOrgs = async () => await get(UOI_GOOGLE_SHEET_URL);

const covertGoogleSheetJsonToOrgsJson = ({ values = [] } = {}) => {

  const ORGS_COLUMNS = [
    "OrganizationUniqueId",
    "OrganizationType",
    "AssnToMls",
    "OrganizationName",
    "OrganizationAddress1",
    "OrganizationCity",
    "OrganizationStateOrProvince",
    "OrganizationPostalCode",
    "OrganizationWebsite",
    "OrganizationCountry",
    "ModificationTimestamp",
    "OrganizationLatitude",
    "OrganizationLongitude",
    "OrganizationMemberCount",
    "OrganizationCertName"
  ];

  const keys = values[0] || [],
    data = values.slice(1, values.length) || [];

  return data.reduce((results, items = []) => {
    const transformed = items.reduce((acc, item, index) => {
      acc[keys[index]] = item;
      return acc;
    }, {});

    if (isOrganizationActive(transformed)) {
      results.push(ORGS_COLUMNS.reduce((acc, columnName) => {
        acc[columnName] = transformed[columnName] || null;
        return acc;
      }, {}));
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
      results[uoi].push(endorsements.map(
        ({ type, version, status, providerUoi, statusUpdatedAt }) => {
          return {
            endorsement: getEndorsementTypeDisplayName(type),
            version,
            status: getEndorsementDisplayName(status),
            providerUoi,
            statusUpdatedAt,
          };
        }
      ));
    });

  } while (lastStatusCode >= 200 && lastStatusCode < 300);

  return results;
};

const fetchOrgsAndEndorsements = async () => {
  const endorsements = await fetchEndorsements();
  const orgs = await fetchOrgs();

  return orgs.map(org => {
    const { OrganizationUniqueId } = org;
    if (endorsements[OrganizationUniqueId]?.length) {
      org[MAPPED_ENDORSEMENTS_FIELD_NAME] = endorsements[OrganizationUniqueId];
    }
    return org;
  });
};

const post = async (url, body = {}) => {
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `ApiKey ${API_KEY}`,
    },
    maxRedirects: 5,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let rawData = "";

      res.on("data", (chunk) => {
        rawData += chunk;
      });

      res.on("end", () => {
        try {
          resolve({ statusCode: res?.statusCode, data: JSON.parse(rawData) });
        }
        catch (err) {
          reject(new Error(err));
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error(err));
    });

    req.write(JSON.stringify(body));
    req.end();
  });
};

const get = async (url) => {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let rawData = "";

      res.on("data", (chunk) => {
        rawData += chunk;
      });

      res.on("end", () => {
        try {
          resolve(JSON.parse(rawData));
        }
        catch (err) {
          reject(new Error(err));
        }
      });
    });

    req.on("error", (err) => {
      reject(new Error(err));
    });
  });
};

module.exports = {
  fetchOrgsAndEndorsements
};

