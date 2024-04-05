# cell-cli
cell-cli is a shell wrapper of [`ckb-cli`](https://github.com/nervosnetwork/ckb-cli) with features for Cell Script.




# Usage

```shell
git clone git@github.com:cell-labs/cell-cli.git
## Enter your CKB private key in cell.config.js
npm install
npm install -g .
cell-cli deploy ./helloworld


```
## 验证创建代币的过程
node ./createCoin.js

## 验证代币转移的过程 -- 暂未实现
node ./transferCoin.js