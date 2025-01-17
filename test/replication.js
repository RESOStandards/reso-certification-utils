const { getMetadata } = require('@reso/reso-certification-etl/lib/common');
const { createReplicationStateServiceInstance } = require('../common');
const { scorePayload } = require('../lib/replication/utils');
const assert = require('assert');

describe('Replication tests', () => {
  it('Should not throw error is non-string non-array value is present', async () => {
    const metadataReport = getMetadata('2.0');
    const payload = {
      '@reso.context': 'urn:reso:metadata:1.7:resource:property',
      value: [
        {
          Country: 'CA',
          StateOrProvince: 'ON',
          BusinessType: 5 // non-string non-array lookup value
        }
      ]
    };

    const replicationInstance = createReplicationStateServiceInstance();
    replicationInstance.setMetadataMap(metadataReport);

    assert.doesNotThrow(() => {
      scorePayload({
        expansionInfo: [],
        jsonData: payload,
        replicationStateServiceInstance: replicationInstance,
        resourceName: 'Property'
      });
    });
  });
});
