import GoPlus from '@goplus/sdk-node';

/**
 * @class GoPlusAudit
 * @description This class is used to run the GoPlus audit on the new token
 */
export class GoPlusAudit {
  /**
   * @constructor
   * @description This constructor is used to initialize the GoPlusAudit class
   */
  constructor(app, chainId, newTokenAddress) {
    this.app = app;
    this.chainId = chainId;
    this.newTokenAddress = newTokenAddress;
  }

  /**
   * Checks if the address is malicious
   * @param {string} chainId
   * @param {string} targetAddress
   * @returns {object} malicious results
   */
  async maliciousCheck() {
    console.log('RUNNING MALICIOUS CHECK');

    // Wait for 1 second if counter is greater than 30
    while (this.app.goPlusCalls >= 30) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('THIS IS AFTER THE MALICIOUS WHILE LOOP');

    try {
      // Get the address security data
      const response = await GoPlus.addressSecurity(this.chainId, this.newTokenAddress);

      console.log('MALISOUS RESULTS', response);

      // Increment the number of audits calls
      this.app.goPlusCalls++;
      return response.result;
    } catch (error) {
      console.log(
        'There was a problem retrieving data from GoPlus address security api call.\n',
        error
      );

      return null;
    }
  }

  /**
   * Fetches the security data from the GoPlus API
   * @param {string} chainId
   * @param {string} targetAddress
   * @returns {object} security data
   */
  async fetchSecurityData() {
    console.log('FETCHING SECURITY DATA');

    const MAX_RETRIES = 12;
    const RETRY_DELAY = 10000; // 10 seconds
    const TIMEOUT = 45;
    let retryCount = 0;

    // A recursive function to fetch the security data
    const fetchData = async () => {
      let response;
      // Wait for the counter to be less than 30
      while (this.app.goPlusCalls >= 30) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Make the GoPlus Data
      try {
        // Make the GoPlus API call
        response = await GoPlus.tokenSecurity(this.chainId, this.newTokenAddress, TIMEOUT);

        // Increment the number of audits calls
        this.app.goPlusCalls++;
      } catch (error) {
        // Retry if it fails 12 times
        if (retryCount < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          retryCount++;
          return fetchData();
        }
        console.error('GoPlus token security API call failed:', error);
        return false;
      }

      // Check max retries
      if (retryCount >= MAX_RETRIES) {
        console.log('Max retries reached, unable to fetch data from GoPlus');
        console.log('');
        return false;
      }

      // Handle rate limit error
      if (response.code === 4029) {
        console.log('GoPlus Rate Limit Reached. Retries left: ', MAX_RETRIES - retryCount);
        console.log('');
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        retryCount++;
        return fetchData();
      }
      // Handle invalid or empty response
      else if (
        !response ||
        response === undefined ||
        Object.keys(response).length === 0 ||
        Object.keys(response.result).length === 0
      ) {
        console.log('GoPlus data is invalid or empty. Retries left: ', MAX_RETRIES - retryCount);
        console.log('');
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        retryCount++;
        return fetchData();
      }

      // Return the first key's value from the response
      return response.result[Object.keys(response.result)[0]];
    };

    // Get the security data
    const response = await fetchData();
    console.log('RESPONES FROM FETCH SECURITY DATA:', response);

    // If the response is false, return the failure
    if (!response) {
      return false;
    }

    return response;
  }

  /**
   * Checks if the contract is open source and if trading is secure
   * @param {string} chainId
   * @param {string} targetAddress
   * @returns {object} security data
   */
  async securityCheck() {
    console.log('RUNNING SECURITY CHECK');

    // Remove unused parameters
    // Trading Security Checks
    const tradingSecurityChecks = ['cannot_buy', 'cannot_sell_all'];

    console.log('Fetching security data for:', this.newTokenAddress);

    // Get the security data
    const data = await this.fetchSecurityData(); // Remove parameters

    if (!data) {
      console.log('Failed to fetch security data');
      return {
        success: false,
        data: null,
        reason: 'GoPlus API call failed',
      };
    }

    console.log('Security data received, checking conditions...');

    // Check if contract is open source first
    if (data.is_open_source !== '1') {
      console.log('Contract is not open source');
      return {
        success: false,
        data: data,
        reason: 'Contract not open source',
      };
    }

    // Check if trading is secure
    const isTradingSecure = tradingSecurityChecks.every(check => data[check] === '0');

    if (!isTradingSecure) {
      console.log('Trading is not secure');
      return {
        success: false,
        data: data,
        reason: 'Trading not secure',
      };
    }

    // Check if the buy/sell tax is unknown
    if (data.buy_tax === '' || data.sell_tax === '') {
      console.log('Buy/sell tax is unknown');
      return {
        success: false,
        data: data,
        reason: 'Unknown buy/sell tax',
      };
    }

    const buyTax = parseFloat(data.buy_tax);
    const sellTax = parseFloat(data.sell_tax);
    const MAX_TAX = 0.2;

    console.log(`Buy tax: ${buyTax}, Sell tax: ${sellTax}`);

    if (buyTax <= MAX_TAX && sellTax <= MAX_TAX) {
      console.log('Tax levels acceptable');
      return { success: true, data: { ...data } };
    } else {
      console.log('Tax levels too high');
      return {
        success: false,
        data: { ...data },
        reason: 'Buy/Sell tax too high',
      };
    }
  }

  /**
   * Runs the GoPlus audit
   * @param {string} chainId
   * @param {string} newTokenAddress
   * @returns {object} audit results
   */
  async main() {
    console.log('RUNNING SECURITY ANALYSIS');

    // Get the security results
    const securityResults = await this.securityCheck();
    console.log(securityResults);

    // If it fails the security check return
    if (!securityResults.success) {
      console.log('AUDIT UNSUCESSFUL');

      return {
        success: false,
        data: { ...securityResults.data },
      };
    }

    // Get the malicious results
    const maliciousResults = await this.maliciousCheck(this.chainId, this.newTokenAddress);

    console.log('AUDIT SUCCESFUL');

    return {
      success: maliciousResults.success,
      data: { ...securityResults.data, ...maliciousResults },
    };
  }
}
