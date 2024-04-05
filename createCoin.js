const {
  helpers,
  Indexer,
  commons,
  config,
  RPC,
  hd,
} = require("@ckb-lumos/lumos");
const {values} =require("@ckb-lumos/base") 
const { computeScriptHash } =require ("@ckb-lumos/base/lib/utils")
const { createTransactionFromSkeleton,minimalCellCapacityCompatible } =require("@ckb-lumos/helpers") 
const { bytes, number } =require( "@ckb-lumos/codec")
const { BI, BIish } =require( "@ckb-lumos/bi")

const { initializeConfig } = require("@ckb-lumos/config-manager");
const cellConfig = require("./cell.config.js");

// 初始化配置

const CKB_RPC_URL =cellConfig.rpcUrl;
const CKB_INDEXER_URL =cellConfig.indexerURL;
const rpc = new RPC(CKB_RPC_URL);

const privateKey = cellConfig.privateKey;
const recipientAddress = cellConfig.address;


async function createSUDTTx() {
  initializeConfig(config.predefined.AGGRON4)

  const amount = 200000; // 发行20万个代币
  let txSkeleton = helpers.TransactionSkeleton({
    cellProvider: new Indexer('https://testnet.ckb.dev/indexer'),
  });
    
  txSkeleton = await issueToken(
    txSkeleton,
    recipientAddress,
    amount,
  );

  txSkeleton = await commons.common.payFeeByFeeRate(
    txSkeleton,
    [recipientAddress],
    1000,
  );
  txSkeleton = commons.common.prepareSigningEntries(txSkeleton);

  return txSkeleton;

}

async function signAndSendTransaction(txSkeleton, privateKey) {
    const message = txSkeleton.get('signingEntries').get(0).message;
    const Sig = hd.key.signRecoverable(message, privateKey);
    const tx = helpers.sealTransaction(txSkeleton, [Sig]);
    const txHash = await rpc.sendTransaction(tx, 'passthrough');
    console.log(`Transaction has been sent with tx hash ${txHash}`);
}

async function issueToken(
    txSkeleton,
    fromInfo,
    amount ,
    capacity ,
    tipHeader
  ){
  
    txSkeleton =  addCellDep(txSkeleton, {
      outPoint: {
        txHash: '0x442ae633b7d662959ea09e2fe96977f498cb73e8e66b0e2efa94e700194f31e1',
        index: '0x0',
      },
      depType: 'code',
    });
  
    const fromScript = commons.parseFromInfo(fromInfo, { config:config.predefined.AGGRON4 }).fromScript;
  
    const toScript = fromScript;
    
    const sudtTypeScript = {
      codeHash: "0x40546f50d26202db22d444e500e3dd86c383047d5174d04fdf61e944ba68bd83",
      hashType: "type",
      args: computeScriptHash(fromScript),
    };
  
    const targetOutput = {
      cellOutput: {
        capacity: "0x0",
        lock: toScript,
        type: sudtTypeScript,
      },
      data: bytes.hexify(number.Uint128LE.pack(amount)),
      outPoint: undefined,
      blockHash: undefined,
    };
  
    if (!capacity) {
      capacity = minimalCellCapacityCompatible(targetOutput);
    }
    const _capacity = BI.from(capacity);
    targetOutput.cellOutput.capacity = "0x" + _capacity.toString(16);
  
    txSkeleton = txSkeleton.update("outputs", (outputs) => {
      return outputs.push(targetOutput);
    });
  
    const outputIndex = txSkeleton.get("outputs").size - 1;
  
    // fix entry
    txSkeleton = txSkeleton.update("fixedEntries", (fixedEntries) => {
      return fixedEntries.push({
        field: "outputs",
        index: outputIndex,
      });
    });
  
    txSkeleton = await commons.common.injectCapacity(
      txSkeleton,
      [fromInfo],
      BI.from(BI.from(targetOutput.cellOutput.capacity)),
      undefined,
      tipHeader,
      {
        config:config.predefined.AGGRON4
      }
    );
  
    return txSkeleton;
  }
   function addCellDep(
    txSkeleton ,
    newCellDep 
  ) {
    const cellDep = txSkeleton.get("cellDeps").find((cellDep) => {
      return (
        cellDep.depType === newCellDep.depType &&
        new values.OutPointValue(cellDep.outPoint, { validate: false }).equals(
          new values.OutPointValue(newCellDep.outPoint, { validate: false })
        )
      );
    });
  
    if (!cellDep) {
      txSkeleton = txSkeleton.update("cellDeps", (cellDeps) => {
        return cellDeps.push({
          outPoint: newCellDep.outPoint,
          depType: newCellDep.depType,
        });
      });
    }
  
    return txSkeleton;
  }
// 调用创建交易的函数
(async () => {
  try {
    const txSkeleton = await createSUDTTx();
    // 签名和发送交易
    await signAndSendTransaction(txSkeleton, privateKey);

    console.log("SUDT Token issued successfully.");
  } catch (error) {
    console.error(error);
  }
})();
