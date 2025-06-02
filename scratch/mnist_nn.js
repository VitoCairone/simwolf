// This file is UNTESTED

// mnist_nn.js
// A simple neural network in Node.js for recognizing handwritten digits (MNIST)
// No use of high-level ML libraries like TensorFlow or Brain.js

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// Helper functions for math
function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function dSigmoid(y) {
  return y * (1 - y);
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function zeros(n) {
  return Array(n).fill(0);
}

function randomMatrix(rows, cols) {
  return Array(rows).fill().map(() => Array(cols).fill().map(() => rand(-1, 1)));
}

function dot(a, b) {
  return a.reduce((sum, ai, i) => sum + ai * b[i], 0);
}

function addBias(inputs) {
  return [...inputs, 1];
}

class NeuralNetwork {
  constructor(inputSize, hiddenSize, outputSize) {
    this.inputSize = inputSize + 1; // +1 for bias
    this.hiddenSize = hiddenSize;
    this.outputSize = outputSize;

    this.weightsInputHidden = randomMatrix(this.hiddenSize, this.inputSize);
    this.weightsHiddenOutput = randomMatrix(this.outputSize, this.hiddenSize + 1);
  }

  feedforward(inputs) {
    const biasedInputs = addBias(inputs);

    // Hidden layer
    const hiddenRaw = this.weightsInputHidden.map(row => dot(row, biasedInputs));
    const hiddenActivated = hiddenRaw.map(sigmoid);
    const biasedHidden = addBias(hiddenActivated);

    // Output layer
    const outputRaw = this.weightsHiddenOutput.map(row => dot(row, biasedHidden));
    const outputActivated = outputRaw.map(sigmoid);

    return { hidden: hiddenActivated, biasedHidden, output: outputActivated };
  }

  train(inputs, targets, learningRate = 0.1) {
    const biasedInputs = addBias(inputs);
    const { hidden, biasedHidden, output } = this.feedforward(inputs);

    // Output error
    const outputErrors = targets.map((target, i) => target - output[i]);
    const outputGradients = output.map((o, i) => dSigmoid(o) * outputErrors[i]);

    // Update weights hidden->output
    for (let i = 0; i < this.outputSize; i++) {
      for (let j = 0; j < this.hiddenSize + 1; j++) {
        this.weightsHiddenOutput[i][j] += learningRate * outputGradients[i] * biasedHidden[j];
      }
    }

    // Hidden error
    const hiddenErrors = zeros(this.hiddenSize);
    for (let i = 0; i < this.hiddenSize; i++) {
      for (let j = 0; j < this.outputSize; j++) {
        hiddenErrors[i] += outputGradients[j] * this.weightsHiddenOutput[j][i];
      }
    }

    const hiddenGradients = hidden.map((h, i) => dSigmoid(h) * hiddenErrors[i]);

    // Update weights input->hidden
    for (let i = 0; i < this.hiddenSize; i++) {
      for (let j = 0; j < this.inputSize; j++) {
        this.weightsInputHidden[i][j] += learningRate * hiddenGradients[i] * biasedInputs[j];
      }
    }
  }

  predict(inputs) {
    return this.feedforward(inputs).output;
  }
}

// ---------------------- MNIST LOADING --------------------- //

function loadMNISTImages(filename) {
  const buffer = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, filename)));
  const headerBytes = 16;
  const numImages = buffer.readUInt32BE(4);
  const numRows = buffer.readUInt32BE(8);
  const numCols = buffer.readUInt32BE(12);
  const images = [];

  for (let i = 0; i < numImages; i++) {
    const start = headerBytes + i * numRows * numCols;
    const img = [];
    for (let j = 0; j < numRows * numCols; j++) {
      img.push(buffer[start + j] / 255.0);
    }
    images.push(img);
  }
  return images;
}

function loadMNISTLabels(filename) {
  const buffer = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, filename)));
  const numLabels = buffer.readUInt32BE(4);
  const labels = [];
  for (let i = 0; i < numLabels; i++) {
    labels.push(buffer[8 + i]);
  }
  return labels;
}

function oneHot(label, size = 10) {
  return Array(size).fill(0).map((_, i) => (i === label ? 1 : 0));
}

// ---------------------- MAIN --------------------- //

async function main() {
  console.log('Loading MNIST dataset...');
  const trainImages = loadMNISTImages('train-images-idx3-ubyte.gz');
  const trainLabels = loadMNISTLabels('train-labels-idx1-ubyte.gz');

  const nn = new NeuralNetwork(784, 64, 10);

  console.log('Training...');
  for (let epoch = 0; epoch < 3; epoch++) {
    let totalLoss = 0;
    for (let i = 0; i < 10000; i++) { // Use subset for quick test
      const input = trainImages[i];
      const target = oneHot(trainLabels[i]);
      const output = nn.predict(input);
      const loss = output.reduce((acc, o, j) => acc + Math.pow(o - target[j], 2), 0);
      totalLoss += loss;
      nn.train(input, target);
    }
    console.log(`Epoch ${epoch + 1}: Loss = ${totalLoss.toFixed(2)}`);
  }

  // Test sample
  const testSample = trainImages[10001];
  const prediction = nn.predict(testSample);
  console.log('Prediction:', prediction.map(x => x.toFixed(2)));
  console.log('Predicted digit:', prediction.indexOf(Math.max(...prediction)));
  console.log('Actual digit:', trainLabels[10001]);
}

main();
