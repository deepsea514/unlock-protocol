const assert = require('assert')
const { ethers } = require('hardhat')
const { reverts } = require('../helpers')

const deployContracts = require('../fixtures/deploy')

describe('udt', () => {
  let udt
  let minter, recipient, accounts

  before(async () => {
    ;[, minter, recipient, ...accounts] = await ethers.getSigners()
    ;({ udt } = await deployContracts())
  })

  describe('Supply', () => {
    it('Starting supply is 0', async () => {
      const totalSupply = await udt.totalSupply()
      assert(totalSupply == 0, 'starting supply must be 0')
    })

    describe('Minting tokens', () => {
      const mintAmount = 1000n
      let balanceBefore
      let totalSupplyBefore

      before(async () => {
        balanceBefore = await udt.balanceOf(await recipient.getAddress())
        totalSupplyBefore = await udt.totalSupply()
        await udt.connect(minter).mint(await recipient.getAddress(), mintAmount)
      })

      it('Balance went up', async () => {
        const balanceAfter = await udt.balanceOf(await recipient.getAddress())
        assert.equal(
          balanceAfter,
          balanceBefore + mintAmount,
          'Balance must increase by amount minted'
        )
      })

      it('Total supply went up', async () => {
        const totalSupplyAfter = await udt.totalSupply()
        assert.equal(
          totalSupplyAfter,
          totalSupplyBefore + mintAmount,
          'Total supply must increase by amount minted'
        )
      })
    })
  })

  describe('Transfer', () => {
    const mintAmount = 1000000n

    before(async () => {
      for (let i = 0; i < 3; i++) {
        await udt
          .connect(minter)
          .mint(await accounts[i].getAddress(), mintAmount)
      }
    })

    describe('transfer', async () => {
      const transferAmount = 123n
      let balanceBefore0
      let balanceBefore1

      before(async () => {
        balanceBefore0 = await udt.balanceOf(await accounts[0].getAddress())
        balanceBefore1 = await udt.balanceOf(await accounts[1].getAddress())
      })

      it('normal transfer', async () => {
        await udt
          .connect(accounts[0])
          .transfer(await accounts[1].getAddress(), transferAmount)
        const balanceAfter0 = await udt.balanceOf(
          await accounts[0].getAddress()
        )
        const balanceAfter1 = await udt.balanceOf(
          await accounts[1].getAddress()
        )
        assert(
          balanceBefore0 - transferAmount == balanceAfter0,
          'Sender balance must have gone down by amount sent'
        )
        assert(
          balanceBefore1 + transferAmount == balanceAfter1,
          'Recipient balance must have gone up by amount sent'
        )
      })

      it('transfer to specific address redirects to 0xa39b44c4AFfbb56b76a1BF1d19Eb93a5DfC2EBA9', async () => {
        const balanceBefore = await udt.balanceOf(
          '0xa39b44c4AFfbb56b76a1BF1d19Eb93a5DfC2EBA9'
        )
        await udt
          .connect(accounts[0])
          .transfer(
            '0xcc06dd348169d95b1693b9185CA561b28F5b2165',
            transferAmount
          )
        const balanceAfter = await udt.balanceOf(
          '0xa39b44c4AFfbb56b76a1BF1d19Eb93a5DfC2EBA9'
        )

        assert.equal(balanceAfter - balanceBefore, transferAmount)
      })

      it('transferFrom fail from specific address without balance', async () => {
        await reverts(
          udt
            .connect(accounts[0])
            .transferFrom(
              '0x88ad09518695c6c3712AC10a214bE5109a655671',
              await accounts[1].getAddress(),
              transferAmount
            ),
          'ERC20: transfer amount exceeds balance'
        )
      })
    })
  })

  describe('Minters', () => {
    let newMinter

    before(async () => {
      newMinter = accounts[5]
      await udt.connect(minter).addMinter(await newMinter.getAddress())
    })

    it('newMinter can mint', async () => {
      await udt.connect(newMinter).mint(await accounts[0].getAddress(), 1)
    })

    describe('Renounce minter', () => {
      it('newMinter cannot mint anymore', async () => {
        await udt.connect(newMinter).renounceMinter()
        await reverts(
          udt.connect(newMinter).mint(await accounts[0].getAddress(), 1),
          'MinterRole: caller does not have the Minter role'
        )
      })
    })
  })
})
