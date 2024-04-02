const cellConfig = require('./cell.config.js');
const { commons, config, hd, helpers, Indexer, RPC } = require("@ckb-lumos/lumos");
const { bytes } = require("@ckb-lumos/lumos/codec");

const CONFIG = config.predefined.AGGRON4;
const PRIVATE_KEY = cellConfig.privateKey;

async function deploy(hexData) {
  const fromLock = {
    codeHash: CONFIG.SCRIPTS.SECP256K1_BLAKE160.CODE_HASH,
    hashType: CONFIG.SCRIPTS.SECP256K1_BLAKE160.HASH_TYPE,
    args: hd.key.privateKeyToBlake160(PRIVATE_KEY),
  };
  const fromAddress = helpers.encodeToAddress(fromLock, { config: CONFIG });

  const alwaysSuccess = bytes.bytify(hexData);

  const indexer = new Indexer(cellConfig.indexerURL);
  const rpc = new RPC(cellConfig.rpcUrl);

  let { txSkeleton, scriptConfig, typeId } = await commons.deploy.generateDeployWithTypeIdTx({
    scriptBinary: alwaysSuccess,
    config: CONFIG,
    feeRate: 1000n,
    cellProvider: indexer,
    fromInfo: fromAddress,
  });

  txSkeleton = commons.common.prepareSigningEntries(txSkeleton, { config: CONFIG });

  const signature = hd.key.signRecoverable(txSkeleton.get("signingEntries").get(0).message, PRIVATE_KEY);
  const signedTx = helpers.sealTransaction(txSkeleton, [signature]);

  const txHash = await rpc.sendTransaction(signedTx);
  console.log(`Transaction Hash: ${txHash}`);
  console.log(`Script Config: `, scriptConfig);
  console.log(`Type ID: ${typeId}`);
}

module.exports = { deploy };