'use strict';

const { NOT_OK } = require('../../../../common');

const USER_AGENT_HEADER = 'RESO Replication Client',
  DEFAULT_EXPIRATION_S = 15 * 60, // 15 minutes
  DEFAULT_EXPIRATION_DRIFT_S = 30;

const _authInfo = {
  bearerToken: null,
  clientCredentials: {
    clientId: null,
    clientSecret: null,
    tokenUri: null,
    scope: null
  },
  tokenType: null,
  tokenExpirationDate: null
};

const isClientCredentialsAuth = () =>
  !!(_authInfo?.clientCredentials?.clientId && _authInfo?.clientCredentials?.clientSecret && _authInfo?.clientCredentials?.tokenUri);

let _isInitialized = false;

/**
 * Accessor method for determining whether something is initialized
 * @returns true if initialized, false otherwise
 */
const getIsInitialized = () => !!_isInitialized;

/**
 *
 * Initializes singleton service
 *
 * @param {Object} credentials An object containing either a bearer token or client credentials
 */
const init = async ({ bearerToken, clientCredentials = {} }) => {
  
  try {
    if (bearerToken) {
      _authInfo.bearerToken = bearerToken;
      _isInitialized = true;
    } else if (clientCredentials && Object.values(clientCredentials)?.length) {
      //save for later in case we need to refresh the token
      _authInfo.clientCredentials = clientCredentials;

      await _fetchClientCredentialsAccessToken(clientCredentials);
      _isInitialized = true;
    } else {
      throw new Error('No supported auth credentials were provided! Please pass either bearerToken or clientCredentials.');
    }
  } catch (err) {
    throw new Error(err);
  }
};

const _fetchClientCredentialsAccessToken = async ({ clientId, clientSecret, tokenUri, scope, useBasicAuth = true, useBody } = {}) => {
  try {
    let headers = {},
      body;

    if (useBasicAuth) {
      headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'User-Agent': USER_AGENT_HEADER
      };

      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');

      if (scope && scope?.length) {
        params.append('scope', scope);
      }

      body = params;
    } else if (useBody) {
      throw new Error('Unsupported auth option!');
    } else {
      throw new Error('Unsupported auth type!');
    }

    const response = await fetch(tokenUri, {
      method: 'POST',
      headers,
      body
    });

    const { access_token, expires_in, token_type, scope: responseScope } = await response.json();

    _authInfo.bearerToken = access_token;
    _authInfo.expiresIn = !!expires_in && parseInt(expires_in) > 0 ? expires_in : DEFAULT_EXPIRATION_S;
    _authInfo.tokenType = token_type;
    _authInfo.scope = responseScope;
    _authInfo.tokenExpirationDate = new Date(new Date().setSeconds(new Date().getSeconds() + expires_in - DEFAULT_EXPIRATION_DRIFT_S));
  } catch (err) {
    console.log(err);
    process.exit(NOT_OK);
  }
};

/**
 * Returns the current bearer token, and if the user is using client credentials
 * and the token has expired, the token will refresh
 * @returns a bearer token
 */
const getBearerToken = async () => {
  _checkIsInitialized();

  if (isClientCredentialsAuth()) {
    if (new Date() >= _authInfo.tokenExpirationDate) {
      await _fetchClientCredentialsAccessToken(_authInfo.clientCredentials);
    }
  }
  return _authInfo.bearerToken;
};

/**
 * Handles the case where the service hasn't been initialized before calling
 */
const _checkIsInitialized = () => {
  if (!getIsInitialized()) {
    throw new Error('The auth service MUST be initialized before it can be called. See init()!');
  }
};

/**
 * Creates a bearer token auth header, i.e. "Authorization: Bearer <token>"
 *
 * @param {String} token bearer token to be used for a given HTTP request
 * @returns a header constructed from the given token, or an empty object if the token is invalid
 */
const getOAuth2BearerTokenHeader = async () => {
  _checkIsInitialized();
  return { Authorization: `Bearer ${await getBearerToken()}` };
};

module.exports = {
  init,
  getBearerToken,
  getOAuth2BearerTokenHeader,
  getIsInitialized
};
