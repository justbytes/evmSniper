import { Alchemy, Wallet } from "alchemy-sdk";
import util from "util";
import { exec } from "child_process";
import dotenv from "dotenv";
import { getAlchemySettings } from "../utils/getAlchemySettings.js";

const execPromise = util.promisify(exec);
dotenv.config();

/**
 * Creates a wallet using the Cast Wallet / the wallet in your
 * @param {*} chainId
 * @returns
 */
export const getWallet = async (chainId) => {
  // Create Alchemy provider
  const alchemy = new Alchemy(getAlchemySettings(String(chainId)));

  // Runs the cast wallet command to get the private key for the trading wallet
  let command = `cast wallet decrypt-keystore ${process.env.CAST_WALLET_NAME} --unsafe-password "${process.env.CAST_WALLET_PASSWORD}"`;

  // Execute the command
  const { stdout, stderr } = await execPromise(command);
  if (stderr) {
    throw new Error(`Error decrypting keystore: ${stderr}`);
  }

  // The private key is returned in the stdout
  const privateKey = stdout.slice(26).trim();

  // Use ethers Wallet instead of Alchemy Wallet
  // Connect the wallet to the Alchemy provider
  return new Wallet(privateKey, alchemy);
};
