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
  
  
  async function transferCoin() {
    initializeConfig(config.predefined.AGGRON4)
  
    const amount = 200000; // 发行20万个代币
    let txSkeleton = helpers.TransactionSkeleton({
      cellProvider: new Indexer('https://testnet.ckb.dev/indexer'),
    });
      
    txSkeleton = await commons.sudt.transfer()
  
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

  async function transfer(
    txSkeleton ,
    fromInfos ,
    sudtToken ,
    toAddress ,
    amount ,
    changeAddress ,
    capacity,
    tipHeader,
    {
      config = undefined,
      LocktimePoolCellCollector = LocktimeCellCollector,
      splitChangeCell = false,
    }
  ) {
    
    initializeConfig(config.predefined.AGGRON4)

    let _amount = BI.from(amount);
    let _capacity = capacity ? BI.from(capacity) : undefined;
  
    const SUDT_SCRIPT = config.predefined.AGGRON4.SCRIPTS.SUDT;
  
    if (!SUDT_SCRIPT) {
      throw new Error("Provided config does not have SUDT script setup!");
    }
  
    if (fromInfos.length === 0) {
      throw new Error("`fromInfos` can't be empty!");
    }
  
    if (!toAddress) {
      throw new Error("You must provide a to address!");
    }
    const toScript = parseAddress(toAddress, { config });
  
    const fromScripts = fromInfos.map(
      (fromInfo) => parseFromInfo(fromInfo, { config }).fromScript
    );
    const changeOutputLockScript = changeAddress
      ? parseAddress(changeAddress, { config })
      : fromScripts[0];
  
    if (_amount.lte(0)) {
      throw new Error("amount must be greater than 0");
    }
  
    const sudtType = _generateSudtScript(sudtToken, config);
  
    const cellProvider = txSkeleton.get("cellProvider");
    if (!cellProvider) {
      throw new Error("Cell provider is missing!");
    }
  
    // if toScript is an anyone-can-pay script
    let toAddressInputCapacity  = BI.from(0);
    let toAddressInputAmount  = BI.from(0);
    if (isAcpScript(toScript, config)) {
      const toAddressCellCollector = new AnyoneCanPayCellCollector(
        toAddress,
        cellProvider,
        {
          config,
          queryOptions: {
            type: sudtType,
            data: "any",
          },
        }
      );
  
      const toAddressInput  = (
        await toAddressCellCollector.collect().next()
      ).value;
      if (!toAddressInput) {
        throw new Error(`toAddress ANYONE_CAN_PAY input not found!`);
      }
  
      txSkeleton = txSkeleton.update("inputs", (inputs) => {
        return inputs.push(toAddressInput);
      });
  
      txSkeleton = txSkeleton.update("witnesses", (witnesses) => {
        return witnesses.push("0x");
      });
  
      toAddressInputCapacity = BI.from(toAddressInput.cellOutput.capacity);
      toAddressInputAmount = unpackAmount(toAddressInput.data);
    }
  
    const targetOutput = {
      cellOutput: {
        capacity: "0x0",
        lock: toScript,
        type: sudtType,
      },
      data: bytes.hexify(number.Uint128LE.pack(_amount)),
      outPoint: undefined,
      blockHash: undefined,
    };
    if (isAcpScript(toScript, config)) {
      if (!_capacity) {
        _capacity = BI.from(0);
      }
      targetOutput.cellOutput.capacity =
        "0x" + toAddressInputCapacity.add(_capacity).toString(16);
      targetOutput.data = bytes.hexify(
        number.Uint128LE.pack(toAddressInputAmount.add(_amount))
      );
    } else {
      if (!_capacity) {
        _capacity = BI.from(minimalCellCapacityCompatible(targetOutput));
      }
      targetOutput.cellOutput.capacity = "0x" + _capacity.toString(16);
    }
  
    // collect cells with which includes sUDT info
    txSkeleton = txSkeleton.update("outputs", (outputs) => {
      return outputs.push(targetOutput);
    });
  
    txSkeleton = txSkeleton.update("fixedEntries", (fixedEntries) => {
      return fixedEntries.push({
        field: "outputs",
        index: txSkeleton.get("outputs").size - 1,
      });
    });
  
    txSkeleton = addCellDep(txSkeleton, {
      outPoint: {
        txHash: SUDT_SCRIPT.TX_HASH,
        index: SUDT_SCRIPT.INDEX,
      },
      depType: SUDT_SCRIPT.DEP_TYPE,
    });
  
    // collect cells
    const changeCell  = {
      cellOutput: {
        capacity: "0x0",
        lock: changeOutputLockScript,
        type: sudtType,
      },
      data: bytes.hexify(number.Uint128LE.pack(0)),
      outPoint: undefined,
      blockHash: undefined,
    };
    const changeCellWithoutSudt  = {
      cellOutput: {
        capacity: "0x0",
        lock: changeOutputLockScript,
        type: undefined,
      },
      data: "0x",
      outPoint: undefined,
      blockHash: undefined,
    };
    let changeCapacity = BI.from(0);
    let changeAmount = BI.from(0);
    let previousInputs = Set<string>('');
    for (const input of txSkeleton.get("inputs")) {
      previousInputs = previousInputs.add(
        `${input.outPoint.txHash}_${input.outPoint.index}`
      );
    }
    let cellCollectorInfos = List();
    if (tipHeader) {
      fromInfos.forEach((fromInfo, index) => {
        const locktimePoolCellCollector = new LocktimePoolCellCollector(
          fromInfo,
          cellProvider,
          {
            config,
            tipHeader,
            queryOptions: {
              type: sudtType,
              data: "any",
            },
          }
        );
  
        cellCollectorInfos = cellCollectorInfos.push({
          cellCollector: locktimePoolCellCollector,
          index,
        });
      });
    }
    fromInfos.forEach((fromInfo, index) => {
      const secpCollector = new secp256k1Blake160.CellCollector(
        fromInfo,
        cellProvider,
        {
          config,
          queryOptions: {
            type: sudtType,
            data: "any",
          },
        }
      );
      const multisigCollector = new secp256k1Blake160Multisig.CellCollector(
        fromInfo,
        cellProvider,
        {
          config,
          queryOptions: {
            type: sudtType,
            data: "any",
          },
        }
      );
      const acpCollector = new anyoneCanPay.CellCollector(
        fromInfo,
        cellProvider,
        {
          config,
          queryOptions: {
            type: sudtType,
            data: "any",
          },
        }
      );
  
      cellCollectorInfos = cellCollectorInfos.push(
        {
          cellCollector: secpCollector,
          index,
        },
        {
          cellCollector: multisigCollector,
          index,
        },
        {
          cellCollector: acpCollector,
          index,
          isAnyoneCanPay: true,
          destroyable: parseFromInfo(fromInfo, { config }).destroyable,
        }
      );
    });
    if (tipHeader) {
      fromInfos.forEach((fromInfo, index) => {
        const locktimeCellCollector = new LocktimePoolCellCollector(
          fromInfo,
          cellProvider,
          {
            config,
            tipHeader,
          }
        );
  
        cellCollectorInfos = cellCollectorInfos.push({
          cellCollector: locktimeCellCollector,
          index,
        });
      });
    }
    fromInfos.forEach((fromInfo, index) => {
      const secpCollector = new secp256k1Blake160.CellCollector(
        fromInfo,
        cellProvider,
        {
          config,
        }
      );
      const multisigCollector = new secp256k1Blake160Multisig.CellCollector(
        fromInfo,
        cellProvider,
        {
          config,
        }
      );
      const acpCollector = new anyoneCanPay.CellCollector(
        fromInfo,
        cellProvider,
        {
          config,
        }
      );
  
      cellCollectorInfos = cellCollectorInfos.push(
        {
          cellCollector: secpCollector,
          index,
        },
        {
          cellCollector: multisigCollector,
          index,
        },
        {
          cellCollector: acpCollector,
          index,
          isAnyoneCanPay: true,
          destroyable: parseFromInfo(fromInfo, { config }).destroyable,
        }
      );
    });
    for (const {
      index,
      cellCollector,
      isAnyoneCanPay,
      destroyable,
    } of cellCollectorInfos) {
      for await (const inputCell of cellCollector.collect()) {
        // skip inputs already exists in txSkeleton.inputs
        const key = `${inputCell.outPoint.txHash}_${inputCell.outPoint.index}`;
        if (previousInputs.has(key)) {
          continue;
        }
        previousInputs = previousInputs.add(key);
  
        const fromInfo = fromInfos[index];
        txSkeleton = await common.setupInputCell(
          txSkeleton,
          inputCell,
          fromInfo,
          {
            config,
          }
        );
        // remove output which added by `setupInputCell`
        const lastOutputIndex = txSkeleton.get("outputs").size - 1;
        txSkeleton = txSkeleton.update("outputs", (outputs) => {
          return outputs.remove(lastOutputIndex);
        });
        // remove output fixedEntry
        const fixedEntryIndex = txSkeleton
          .get("fixedEntries")
          .findIndex((fixedEntry) => {
            return (
              fixedEntry.field === "outputs" &&
              fixedEntry.index === lastOutputIndex
            );
          });
        if (fixedEntryIndex >= 0) {
          txSkeleton = txSkeleton.update("fixedEntries", (fixedEntries) => {
            return fixedEntries.remove(fixedEntryIndex);
          });
        }
  
        const inputCapacity = BI.from(inputCell.cellOutput.capacity);
        const inputAmount  = inputCell.cellOutput.type
          ? unpackAmount(inputCell.data)
          : BI.from(0);
        let deductCapacity  =
          isAnyoneCanPay && !destroyable
            ? inputCapacity.sub(minimalCellCapacityCompatible(inputCell))
            : inputCapacity;
        let deductAmount  = inputAmount;
        if (deductCapacity.gt(_capacity)) {
          deductCapacity = BI.from(_capacity);
        }
        _capacity = _capacity.sub(deductCapacity);
        const currentChangeCapacity  = inputCapacity.sub(deductCapacity);
        if (!isAnyoneCanPay || (isAnyoneCanPay && destroyable)) {
          changeCapacity = changeCapacity.add(currentChangeCapacity);
        }
        if (deductAmount.gt(_amount)) {
          deductAmount = _amount;
        }
        _amount = _amount.sub(deductAmount);
        const currentChangeAmount = inputAmount.sub(deductAmount);
        if (!isAnyoneCanPay || (isAnyoneCanPay && destroyable)) {
          changeAmount = changeAmount.add(currentChangeAmount);
        }
  
        if (isAnyoneCanPay && !destroyable) {
          const acpChangeCell  = {
            cellOutput: {
              capacity: "0x" + currentChangeCapacity.toString(16),
              lock: inputCell.cellOutput.lock,
              type: inputCell.cellOutput.type,
            },
            data: inputCell.cellOutput.type
              ? bytes.hexify(number.Uint128LE.pack(currentChangeAmount))
              : "0x",
          };
  
          txSkeleton = txSkeleton.update("outputs", (outputs) => {
            return outputs.push(acpChangeCell);
          });
  
          if (inputCell.cellOutput.type) {
            txSkeleton = txSkeleton.update("fixedEntries", (fixedEntries) => {
              return fixedEntries.push({
                field: "outputs",
                index: txSkeleton.get("outputs").size - 1,
              });
            });
          }
        }
  
        // changeAmount = 0n, the change output no need to include sudt type script
        if (
          _capacity.eq(0) &&
          _amount.eq(0) &&
          ((changeCapacity.eq(0) && changeAmount.eq(0)) ||
            (changeCapacity.gt(
              minimalCellCapacityCompatible(changeCellWithoutSudt)
            ) &&
              changeAmount.eq(0)))
        ) {
          changeCell.cellOutput.type = undefined;
          changeCell.data = "0x";
          break;
        }
        if (
          _capacity.eq(0) &&
          _amount.eq(0) &&
          changeCapacity.gt(
            minimalCellCapacityCompatible(changeCellWithoutSudt)
          ) &&
          changeAmount.gt(0)
        ) {
          break;
        }
      }
    }
  
    // if change cell is an anyone-can-pay cell and exists in txSkeleton.get("outputs") and not in fixedEntries
    // 1. change lock script is acp
    // 2. lock and type are equal to output OutputA in outputs
    // 3. OutputA is not fixed.
    let changeOutputIndex = -1;
    if (
      isAcpScript(changeCell.cellOutput.lock, config) &&
      (changeOutputIndex = txSkeleton.get("outputs").findIndex((output) => {
        return (
          new ScriptValue(changeCell.cellOutput.lock, {
            validate: false,
          }).equals(
            new ScriptValue(output.cellOutput.lock, { validate: false })
          ) &&
          ((changeAmount.eq(0) &&
            !changeCell.cellOutput.type &&
            !output.cellOutput.type) ||
            (changeAmount.gte(0) &&
              !!changeCell.cellOutput.type &&
              !!output.cellOutput.type &&
              new ScriptValue(changeCell.cellOutput.type, {
                validate: false,
              }).equals(
                new ScriptValue(output.cellOutput.type, { validate: false })
              )))
        );
      })) !== -1 &&
      txSkeleton.get("fixedEntries").findIndex((fixedEntry) => {
        return (
          fixedEntry.field === "output" && fixedEntry.index === changeOutputIndex
        );
      }) === -1
    ) {
      const originOutput = txSkeleton.get("outputs").get(changeOutputIndex);
      const clonedOutput = JSON.parse(JSON.stringify(originOutput));
      clonedOutput.cellOutput.capacity =
        "0x" +
        BI.from(originOutput.cellOutput.capacity)
          .add(changeCapacity)
          .toString(16);
      if (changeAmount.gt(0)) {
        clonedOutput.data = bytes.hexify(
          number.Uint128LE.pack(unpackAmount(originOutput.data).add(changeAmount))
        );
      }
  
      const minimalChangeCellCapcaity = BI.from(
        minimalCellCapacityCompatible(changeCell)
      );
      const minimalChangeCellWithoutSudtCapacity = BI.from(
        minimalCellCapacityCompatible(changeCellWithoutSudt)
      );
      let splitFlag = false;
      if (
        changeAmount.gt(0) &&
        splitChangeCell &&
        changeCapacity.gte(
          minimalChangeCellCapcaity.add(minimalChangeCellWithoutSudtCapacity)
        )
      ) {
        clonedOutput.cellOutput.capacity = originOutput.cellOutput.capacity;
        changeCellWithoutSudt.cellOutput.capacity =
          "0x" + changeCapacity.toString(16);
        splitFlag = true;
      }
  
      txSkeleton = txSkeleton.update("outputs", (outputs) => {
        return outputs.set(changeOutputIndex, clonedOutput);
      });
  
      if (splitFlag) {
        txSkeleton = txSkeleton.update("outputs", (outputs) => {
          return outputs.push(changeCellWithoutSudt);
        });
      }
    } else if (changeCapacity.gte(minimalCellCapacityCompatible(changeCell))) {
      changeCell.cellOutput.capacity = "0x" + changeCapacity.toString(16);
      if (changeAmount.gt(0)) {
        changeCell.data = bytes.hexify(number.Uint128LE.pack(changeAmount));
      }
  
      const minimalChangeCellCapcaity = BI.from(
        minimalCellCapacityCompatible(changeCell)
      );
      const minimalChangeCellWithoutSudtCapacity = BI.from(
        minimalCellCapacityCompatible(changeCellWithoutSudt)
      );
      let splitFlag = false;
      if (changeAmount.gt(0) && splitChangeCell) {
        if (
          changeCapacity.gte(
            minimalChangeCellCapcaity.add(minimalChangeCellWithoutSudtCapacity)
          )
        ) {
          changeCell.cellOutput.capacity =
            "0x" + minimalChangeCellCapcaity.toString(16);
          changeCellWithoutSudt.cellOutput.capacity =
            "0x" + changeCapacity.sub(minimalChangeCellCapcaity).toString(16);
          splitFlag = true;
        }
      }
  
      txSkeleton = txSkeleton.update("outputs", (outputs) =>
        outputs.push(changeCell)
      );
      if (changeAmount.gt(0)) {
        txSkeleton = txSkeleton.update("fixedEntries", (fixedEntries) => {
          return fixedEntries.push({
            field: "outputs",
            index: txSkeleton.get("outputs").size - 1,
          });
        });
      }
      if (splitFlag) {
        txSkeleton = txSkeleton.update("outputs", (outputs) => {
          return outputs.push(changeCellWithoutSudt);
        });
      }
    } else if (
      changeAmount.gt(0) &&
      changeCapacity.lt(minimalCellCapacityCompatible(changeCell))
    ) {
      throw new Error("Not enough capacity for change in from infos!");
    }
    if (_capacity.gt(0)) {
      throw new Error("Not enough capacity in from infos!");
    }
    if (_amount.gt(0)) {
      throw new Error("Not enough amount in from infos!");
    }
  
    return txSkeleton;
  }
  // 调用创建交易的函数
  (async () => {
    try {
      const txSkeleton = await transferCoin();
      // 签名和发送交易
      await signAndSendTransaction(txSkeleton, privateKey);
  
      console.log("SUDT Token issued successfully.");
    } catch (error) {
      console.error(error);
    }
  })();
  