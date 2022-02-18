import React, {
  ReactChild,
  ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import ReactDOM from "react-dom";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import "./index.css";
import { CSSProperties } from "react";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const SERIAL_PORT_OPTIONS = {
  baudRate: 115200,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
};

function Centerer({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        width: "100%",
      }}
    >
      {children}
    </div>
  );
}

const ADC_BUFFER_SIZE = 1024;
const ADC_CHART_LABELS = [...Array(ADC_BUFFER_SIZE).keys()];
function ADCChart({ values }: { values: number[] | null }) {
  if (values === null) {
    values = [];
  }
  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: "top" as const,
      },
      title: {
        display: true,
        text: "ADC Reading",
        color: "white",
      },
    },
    scales: {
      y: {
        min: 0,
        max: 3.3e6,
        ticks: {
          color: "#bdae93",
        },
        grid: {
          color: "#504945",
        },
        title: {
          display: true,
          text: "Microvolts",
          color: "white",
          align: "center" as "center",
        },
      },
      x: {
        ticks: {
          color: "#bdae93",
        },
        grid: {
          color: "#504945",
        },
        title: {
          display: true,
          text: "Sample Number",
          color: "white",
          align: "center" as "center",
        },
      },
    },
    pointRadius: 0,
  };

  const data = {
    labels: ADC_CHART_LABELS,
    datasets: [
      {
        label: "Dataset 1",
        data: values,
        borderColor: "#83a598",
      },
    ],
  };
  return <Line options={options} data={data}></Line>;
}

interface UARTResponseSchema {
  path: string;
  value: any;
}

interface ADCSchemaValue {
  voltages: number[];
  rmsV: number;
  rmsP: number;
  dBSPL: number;
}

interface ADCSchema extends UARTResponseSchema {
  path: "ADC";
  value: ADCSchemaValue;
}

function isADCSchema(obj: any): obj is ADCSchema {
  return obj.path === "ADC";
}

interface BatterySchema extends UARTResponseSchema {
  path: "BAT";
  value: number;
}
function isBatterySchema(obj: any): obj is BatterySchema {
  return obj.path === "BAT";
}

interface AppSetters {
  setADCValues: Function;
  setBatteryValue: Function;
}

function messageHandler(message: UARTResponseSchema, setters: AppSetters) {
  console.log("Handling Message", message);
  if (isBatterySchema(message)) {
    setters.setBatteryValue(message.value);
  } else if (isADCSchema(message)) {
    setters.setADCValues(message.value);
  } else {
    console.log("INVALID MESSAGE SCHEMA", message);
  }
}

function CenteredButton(props: any) {
  return (
    <button style={{ marginLeft: "auto", marginRight: "auto" }} {...props} />
  );
}

function FlexColumn({
  children,
  style,
}: {
  children: ReactNode;
  style: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function FlexRow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}

function App() {
  const [isSupported, setIsSupported] = useState(true);
  const [currentPort, setCurrentPort] = useState<SerialPort | null>(null);
  const [adcValues, setADCValues] = useState({} as ADCSchemaValue);
  const [batteryValue, setBatteryValue] = useState(null);

  const requestPorts = useCallback(async () => {
    if (!(navigator as any).serial) {
      return;
    }
    let port = null;
    try {
      port = await (navigator as any).serial.requestPort();
    } catch {
      console.log("Did Not Choose any devices");
      return;
    }
    try {
      await port.open(SERIAL_PORT_OPTIONS);
    } catch {
      console.log("Failed to open");
    }
    console.log("Opening Serial Port");
    setCurrentPort(port);
  }, []);

  const writeToSerial = useCallback(
    async (text) => {
      if (currentPort === null || currentPort.writable == null) {
        console.error("Tried to write to null port");
        return;
      }
      const encoder = new TextEncoder();
      const writer = currentPort.writable.getWriter();
      await writer.write(encoder.encode(text));
      writer.releaseLock();
    },
    [currentPort]
  );

  useEffect(() => {
    //can't call async function from useEffect directly
    const MAX_ITERATIONS = 1000;
    async function readFromSerial() {
      if (currentPort === null) {
        return;
      }
      while (currentPort.readable) {
        const reader = currentPort.readable.getReader();
        try {
          let message = "";
          while (true) {
            //tracks if a message is in progress
            let iterations = 0;
            let messagesToHandle: string[] = [];
            while (
              iterations < MAX_ITERATIONS &&
              messagesToHandle.length == 0
            ) {
              const { ["value"]: rawBuffer, done } = await reader.read();
              if (done) {
                console.log("reader canceled");
                // |reader| has been canceled.
                break;
              }
              let value = new TextDecoder().decode(rawBuffer);
              message = message.concat(value);
              const messages = message.split("\n");
              if (messages.length === 0) {
                continue;
              }
              message = messages[messages.length - 1];
              messagesToHandle = messages.slice(0, messages.length - 1);
              iterations++;
            }
            for (const messageToHandle of messagesToHandle) {
              let messageObject;
              try {
                messageObject = JSON.parse(messageToHandle);
                messageHandler(messageObject, {
                  setADCValues,
                  setBatteryValue,
                });
              } catch {
                console.log("Received Non-JSON message", messageToHandle);
              }
            }
            messagesToHandle = [];
          }
        } catch (error) {
          console.error(error);
          // Handle |error|...
        } finally {
          reader.releaseLock();
        }
      }
    }

    readFromSerial();
  }, [currentPort]);

  useEffect(() => {
    if (!("serial" in navigator)) {
      setIsSupported(false);
    }
    // (navigator as any).serial.getPorts().then((ports: SerialPort[]) => ports);
    // (navigator as any).serial.addEventListener("connect", () => {
    //   // Connect to `e.target` or add it to a list of available ports.
    // });

    // (navigator as any).serial.addEventListener("disconnect", () => {
    //   // Remove `e.target` from the list of available ports.
    // });
  });
  if (!isSupported) {
    return <h1> Please use a browser that support serial api</h1>;
  }
  if (currentPort === null) {
    return (
      <Centerer>
        <h1> Please choose a serial port </h1>
        <button onClick={requestPorts}>Choose Serial Port</button>
      </Centerer>
    );
  }

  return (
    <Centerer>
      <h1>Sensor Node Test Suite</h1>
      <hr style={{ width: "30%" }} />
      <FlexRow>
        <FlexColumn style={{ width: "48%", marginBottom: "auto" }}>
          <CenteredButton onClick={() => writeToSerial("ADC")}>
            Get ADC
          </CenteredButton>
          <ADCChart values={adcValues.voltages}></ADCChart>
          <h3>
            RMS ADC Voltage - DC Offset:{" "}
            {(adcValues.rmsV && `${adcValues.rmsV} V`) || "N/A V"}
          </h3>
          <h3>
            RMS Sound Pressure:{" "}
            {(adcValues.rmsP && `${adcValues.rmsP} Pa`) || "N/A Pa"}
          </h3>
          <h3>
            dB SPL: {(adcValues.dBSPL && `${adcValues.dBSPL} dB`) || "N/A dB"}
          </h3>
        </FlexColumn>
        <FlexColumn style={{ width: "48%", marginBottom: "auto" }}>
          <CenteredButton onClick={() => writeToSerial("BAT")}>
            Get Battery Voltage
          </CenteredButton>
          <h3>
            Battery Voltage: {(batteryValue && `${batteryValue} V`) || "N/A V"}
          </h3>
        </FlexColumn>
      </FlexRow>
    </Centerer>
  );
}

ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById("root")
);
