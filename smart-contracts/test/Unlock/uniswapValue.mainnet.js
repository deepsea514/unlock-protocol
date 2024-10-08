const assert = require('assert')
const { ethers } = require('hardhat')
const { mainnet } = require('@unlock-protocol/networks')

const ERC20ABI = require('@unlock-protocol/hardhat-helpers/dist/ABIs/erc20.json')
const USDCabi = require('@unlock-protocol/hardhat-helpers/dist/ABIs/USDC.json')

const {
  ADDRESS_ZERO,
  deployLock,
  deployERC20,
  purchaseKey,
  purchaseKeys,
} = require('../helpers')

const { impersonate } = require('@unlock-protocol/hardhat-helpers')

const {
  mainnet: { tokens },
} = require('@unlock-protocol/networks')

const { unlockAddress } = mainnet
const keyPrice = ethers.parseUnits('0.01', 'ether')
const totalPrice = keyPrice * 5n

// USDC (only 6 decimals)
const keyPriceUSDC = ethers.parseUnits('50', 6)
const totalPriceUSDC = keyPriceUSDC * 5n

const WETH = tokens.find((token) => token.symbol === 'WETH').address
const USDC = tokens.find((token) => token.symbol === 'USDC').address
const DAI = tokens.find((token) => token.symbol === 'DAI').address

const FEE = 500
const deployUniswapV3Oracle = async function () {
  const {
    uniswapV3: { factoryAddress },
  } = mainnet
  const UnlockUniswapOracle = await ethers.getContractFactory('UniswapOracleV3')
  const oracle = await UnlockUniswapOracle.deploy(factoryAddress, FEE)
  return oracle
}

describe('Unlock / uniswapValue', () => {
  let lock
  let unlock
  let token
  let oracle
  let oracleAddress
  let signer
  let keyOwner

  before(async function () {
    if (!process.env.RUN_FORK) {
      // all suite will be skipped
      this.skip()
    }
    ;[signer, keyOwner] = await ethers.getSigners()
    unlock = await ethers.getContractAt('Unlock', unlockAddress)

    // deploy oracle
    oracle = await deployUniswapV3Oracle()
    oracleAddress = await oracle.getAddress()

    //impersonate unlock multisig
    const unlockOwner = await unlock.owner()
    await impersonate(unlockOwner)
    const unlockSigner = await ethers.getSigner(unlockOwner)
    unlock = unlock.connect(unlockSigner)
  })

  it('weth is set correctly already', async () => {
    assert.equal(await unlock.weth(), WETH)
  })

  it('oracle for USDC was already set to the v2 oracle address', async () => {
    assert.notEqual(oracleAddress, await unlock.uniswapOracles(USDC))
  })

  describe('A supported token (USDC)', () => {
    let usdc
    before(async () => {
      // mint some usdc
      usdc = await ethers.getContractAt(USDCabi, USDC)
      const masterMinter = await usdc.masterMinter()
      await impersonate(masterMinter)
      const minter = await ethers.getSigner(masterMinter)
      await usdc
        .connect(minter)
        .configureMinter(await signer.getAddress(), totalPriceUSDC)
      await usdc.mint(await signer.getAddress(), totalPriceUSDC)

      // add oracle support for USDC
      await unlock.setOracle(USDC, await oracle.getAddress())

      // create a USDC lock
      lock = await deployLock({
        unlock,
        tokenAddress: USDC,
        keyPrice: keyPriceUSDC,
      })
    })

    it('sets oracle address correctly', async () => {
      assert.equal(oracleAddress, await unlock.uniswapOracles(USDC))
    })

    it('pricing is set correctly', async () => {
      // make sure price is correct
      assert.equal(await lock.tokenAddress(), USDC)
      assert.equal(await lock.keyPrice(), keyPriceUSDC)
    })

    describe('Purchase keys', () => {
      let gnpBefore
      let blockNumber
      let rate

      before(async () => {
        gnpBefore = await unlock.grossNetworkProduct()
        // approve purchase
        await usdc
          .connect(signer)
          .approve(await lock.getAddress(), totalPriceUSDC)
        ;({ blockNumber } = await purchaseKeys(lock, 5, true))

        // consult our oracle independently for 1 USDC
        rate = await oracle.consult(USDC, ethers.parseUnits('1', 6), WETH)
      })

      it('GDP went up by the expected ETH value', async () => {
        const GNP = await unlock.grossNetworkProduct()
        assert.notEqual(GNP, gnpBefore)

        // 5 keys at 50 USDC at oracle rate
        const priceConverted = rate * 250n
        assert.equal(GNP / 10000n, (gnpBefore + priceConverted) / 10000n)

        // show approx value in ETH for reference
        console.log(`250 USDC =~ ${ethers.formatUnits(GNP)} ETH`)
      })

      it('a GDP tracking event has been emitted', async () => {
        const events = await unlock.queryFilter('GNPChanged', blockNumber)
        // 1 record per purchase
        assert.equal(events.length, 5)

        events.forEach(
          async (
            {
              args: {
                grossNetworkProduct,
                _valueInETH,
                tokenAddress,
                value,
                lockAddress,
              },
            },
            i
          ) => {
            assert.equal(tokenAddress, USDC)
            assert.equal(lockAddress, await lock.getAddress())
            assert.equal(value, keyPriceUSDC)
            // rate * 50 USDC per key
            assert.equal(_valueInETH / 1000n, (rate * 50n) / 1000n)
            assert.equal(
              gnpBefore + (rate * 50n * BigInt(i + 1)) / 1000n,
              grossNetworkProduct / 1000n
            )
          }
        )
        const gnp = await unlock.grossNetworkProduct()
        assert.equal(gnp, events[4].args.grossNetworkProduct)
      })
    })
  })

  describe('A supported token (DAI)', () => {
    let Dai_Token
    before(async () => {
      // mint some usdc
      Dai_Token = await ethers.getContractAt(ERC20ABI, DAI)

      // transfer from the contract itself
      await impersonate(DAI)
      const daiOwner = await ethers.getSigner(DAI)
      await Dai_Token.connect(daiOwner).transfer(
        await signer.getAddress(),
        totalPrice
      )

      // add oracle support for DAI
      await unlock.setOracle(DAI, await oracle.getAddress())

      // create a DAI lock
      lock = await deployLock({
        unlock,
        tokenAddress: DAI,
        keyPrice,
      })
    })

    it('sets oracle address correctly', async () => {
      assert.equal(oracleAddress, await unlock.uniswapOracles(DAI))
    })

    it('pricing is set correctly', async () => {
      // make sure price is correct
      assert.equal(await lock.tokenAddress(), DAI)
      assert.equal(await lock.keyPrice(), keyPrice)
    })

    describe('Purchase keys', () => {
      let gnpBefore
      let blockNumber
      let rate

      before(async () => {
        gnpBefore = await unlock.grossNetworkProduct()
        // approve purchase
        await Dai_Token.connect(signer).approve(
          await lock.getAddress(),
          totalPrice
        )
        ;({ blockNumber } = await purchaseKeys(lock, 5, true))

        // consult our oracle independently for 1 DAI
        rate = await oracle.consult(DAI, ethers.parseUnits('1', 18), WETH)
      })

      it('GDP went up by the expected ETH value', async () => {
        const GNP = await unlock.grossNetworkProduct()
        assert.notEqual(GNP, gnpBefore)

        // 5 keys at 50 DAI at oracle rate
        const priceConverted = rate * 250n
        const diff = GNP - (gnpBefore + priceConverted)
        assert.equal(diff <= 1000n, true) // price variation

        // show approx value in ETH for reference
        console.log(`250 DAI =~ ${ethers.formatUnits(GNP)} ETH`)
      })

      it('a GDP tracking event has been emitted', async () => {
        const events = await unlock.queryFilter('GNPChanged', blockNumber)
        // 1 record per purchase
        assert.equal(events.length, 5)

        events.forEach(
          async (
            {
              args: {
                grossNetworkProduct,
                _valueInETH,
                tokenAddress,
                value,
                lockAddress,
              },
            },
            i
          ) => {
            assert.equal(tokenAddress, DAI)
            assert.equal(lockAddress, lock.address)
            assert.equal(value, keyPrice)
            // rate * 0.01 DAI per key
            assert.equal(_valueInETH, rate * (0.01).div(1000))
            assert.equal(
              gnpBefore.add(rate * 0.01 * (i + 1)).div(1000),
              grossNetworkProduct.div(1000)
            )
          }
        )
        const gnp = await unlock.grossNetworkProduct()
        assert.equal(gnp, events[4].args.grossNetworkProduct)
      })
    })
  })

  describe('A unsupported token', () => {
    beforeEach(async () => {
      token = await deployERC20(signer, true)
      // Mint some tokens for purchase
      await token.mint(await signer.getAddress(), keyPrice)
      lock = await deployLock({
        unlock,
        tokenAddress: await token.getAddress(),
        keyPrice,
      })
    })

    describe('Purchase key', () => {
      let gdpBefore
      let blockNumber

      beforeEach(async () => {
        gdpBefore = await unlock.grossNetworkProduct()
        await token.connect(signer).approve(await lock.getAddress(), keyPrice)
        ;({ blockNumber } = await purchaseKey(
          lock,
          await signer.getAddress(),
          true
        ))
      })

      it('GDP did not change', async () => {
        const gdp = await unlock.grossNetworkProduct()
        assert.equal(gdp, gdpBefore)
      })

      it('a GDP tracking event has been emitted', async () => {
        const events = await unlock.queryFilter('*', blockNumber)
        assert.equal(events.length, 1)

        const { args } = events.find(
          ({ fragment }) => fragment.name === 'GNPChanged'
        )
        const {
          grossNetworkProduct,
          _valueInETH,
          tokenAddress,
          value,
          lockAddress,
        } = args

        const gdp = await unlock.grossNetworkProduct()

        assert.equal(gdp, grossNetworkProduct)
        assert.equal(0, _valueInETH)
        assert.equal(await token.getAddress(), tokenAddress)
        assert.equal(keyPrice, value)
        assert.equal(lockAddress, await lock.getAddress())
      })
    })
  })

  describe('ETH', () => {
    beforeEach(async () => {
      lock = await deployLock({ unlock })
    })

    describe('Purchase key', () => {
      let gdpBefore
      let blockNumber

      beforeEach(async () => {
        gdpBefore = await unlock.grossNetworkProduct()
        ;({ blockNumber } = await purchaseKey(
          lock,
          await keyOwner.getAddress()
        ))
      })

      it('GDP went up by the keyPrice', async () => {
        const gdp = await unlock.grossNetworkProduct()
        assert.equal(gdp, gdpBefore + keyPrice)
      })

      it('a GDP tracking event has been emitted', async () => {
        const events = await unlock.queryFilter('*', blockNumber)
        assert.equal(events.length, 1)

        const { args } = events.find(
          ({ fragment }) => fragment.name === 'GNPChanged'
        )
        const {
          grossNetworkProduct,
          _valueInETH,
          tokenAddress,
          value,
          lockAddress,
        } = args

        const gdp = await unlock.grossNetworkProduct()

        assert.equal(lockAddress, await lock.getAddress())
        assert.equal(ADDRESS_ZERO, tokenAddress)
        assert.equal(gdp, grossNetworkProduct)
        assert.equal(keyPrice, _valueInETH)
        assert.equal(keyPrice, value)
      })
    })
  })
})
