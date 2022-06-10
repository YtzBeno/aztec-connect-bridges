// SPDX-License-Identifier: GPL-2.0-only
// Copyright 2022 Spilsbury Holdings Ltd
pragma solidity >=0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";
import {DefiBridgeProxy} from "../../../aztec/DefiBridgeProxy.sol";
import {RollupProcessor} from "../../../aztec/RollupProcessor.sol";

import {MockPriceFeed} from "./MockPriceFeed.sol";
import {IPriceFeed} from "../../../bridges/liquity/interfaces/IPriceFeed.sol";

contract TestUtil is Test {
    struct Token {
        address addr; // ERC20 Mainnet address
        IERC20 erc;
    }

    IPriceFeed internal constant LIQUITY_PRICE_FEED = IPriceFeed(0x4c517D4e2C851CA76d7eC94B805269Df0f2201De);

    mapping(bytes32 => Token) internal tokens;

    RollupProcessor internal rollupProcessor;

    function setUpTokens() public {
        tokens["LUSD"].addr = 0x5f98805A4E8be255a32880FDeC7F6728C6568bA0;
        tokens["LUSD"].erc = IERC20(tokens["LUSD"].addr);
        vm.label(tokens["LUSD"].addr, "LUSD");

        tokens["WETH"].addr = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
        tokens["WETH"].erc = IERC20(tokens["WETH"].addr);
        vm.label(tokens["WETH"].addr, "WETH");

        tokens["LQTY"].addr = 0x6DEA81C8171D0bA574754EF6F8b412F2Ed88c54D;
        tokens["LQTY"].erc = IERC20(tokens["LQTY"].addr);
        vm.label(tokens["LQTY"].addr, "LQTY");
    }

    function setLiquityPrice(uint256 _price) public {
        IPriceFeed mockFeed = new MockPriceFeed(_price);
        vm.etch(address(LIQUITY_PRICE_FEED), address(mockFeed).code);
        assertEq(LIQUITY_PRICE_FEED.fetchPrice(), _price);
    }

    function rand(uint256 _seed) public pure returns (uint256) {
        // I want a number between 1 WAD and 10 million WAD
        return uint256(keccak256(abi.encodePacked(_seed))) % 10**25;
    }

    function _aztecPreSetup() internal {
        rollupProcessor = new RollupProcessor(address(new DefiBridgeProxy()));
    }
}
